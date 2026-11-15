#!/usr/bin/env python3
"""Bounded I/O broker for omacast file search and previews."""

import fnmatch
import hashlib
import json
import mimetypes
import os
import signal
import stat
import subprocess
import sys
from datetime import datetime

FILES_BYTES = 256 * 1024
FILES_DEADLINE = 3.0
FILES_COUNT = 400
FILES_PATH_CHARS = 1024
FILES_PATTERN_CHARS = 256
FILES_MAX_TERMS = 8
FILES_JSON_BUDGET_CHARS = 200000

PREVIEW_TEXT_BYTES = 32 * 1024
PREVIEW_TEXT_LINES = 60
PREVIEW_LINE_CHARS = 240
PREVIEW_DIR_ENTRIES = 200
PREVIEW_IMAGE_BYTES = 20 * 1024 * 1024

PREVIEW_SECRET_DIRS = {".ssh", ".gnupg", ".aws", ".config/op"}
PREVIEW_SECRET_NAMES = {
    "*.pem", "*.key", "*id_rsa*", "*id_ed25519*", ".env*", ".git-credentials"
}


def emit(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def run_bounded(argv, max_bytes, deadline_sec):
    try:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        return b"", False

    try:
        stdout_data, _ = proc.communicate(timeout=deadline_sec)
        truncated = False
        if len(stdout_data) > max_bytes:
            stdout_data = stdout_data[:max_bytes]
            truncated = True
        return stdout_data, truncated
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        return b"", True


def path_fingerprint(p):
    return hashlib.sha256(p.encode("utf-8", "replace")).hexdigest()[:16]


def cmd_files(argv):
    if len(argv) < 2:
        emit({"ok": False, "error": "files takes directory and pattern", "files": []})
        return

    directory = argv[0]
    pattern = argv[1][:FILES_PATTERN_CHARS].strip()

    if not directory.startswith("/") or len(directory) > FILES_PATH_CHARS or not pattern:
        emit({"ok": False, "error": "bad arguments", "files": []})
        return

    try:
        probe = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        os.close(probe)
    except OSError:
        emit({"ok": True, "files": []})
        return

    terms = pattern.split()[:FILES_MAX_TERMS]
    fd_argv = [
        "fd",
        "--hidden",
        "--follow",
        "--one-file-system",
        "--ignore-case",
        "--exclude",
        ".git",
        "--exclude",
        "node_modules",
        "--exclude",
        ".cache",
        "--max-results",
        str(FILES_COUNT),
    ]
    for term in terms[1:]:
        fd_argv += ["--and", term]
    fd_argv += ["--", terms[0], directory]

    raw, truncated = run_bounded(fd_argv, FILES_BYTES, FILES_DEADLINE)
    lines = raw.decode("utf-8", "replace").split("\n")
    if truncated:
        lines = lines[:-1]

    rows = []
    json_chars = 0
    for line in lines:
        if len(rows) >= FILES_COUNT:
            break
        line = line.strip()
        if not line or len(line) > FILES_PATH_CHARS:
            continue
        is_dir = line.endswith("/")
        path = line[:-1] if is_dir else line
        if not path:
            continue
        slash = path.rfind("/")
        name = path[slash + 1 :] if slash >= 0 else path
        dirname = path[:slash] if slash > 0 else "/"
        row = {
            "id": path_fingerprint(path),
            "path": path,
            "name": name,
            "dir": dirname,
            "isDir": is_dir,
        }
        row_chars = len(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
        if rows and json_chars + row_chars > FILES_JSON_BUDGET_CHARS:
            break
        json_chars += row_chars
        rows.append(row)

    emit({"ok": True, "files": rows})


def _preview_time(seconds):
    try:
        return datetime.fromtimestamp(seconds).strftime("%Y-%m-%d %H:%M")
    except (OverflowError, OSError, ValueError):
        return ""


def _preview_secret_path(path):
    home = os.environ.get("HOME", "")
    for base in {home, os.path.realpath(home)} if home else ():
        for folder in PREVIEW_SECRET_DIRS:
            root = os.path.join(base, folder)
            if path == root or path.startswith(root + "/"):
                return True
    name = os.path.basename(path).lower()
    return any(fnmatch.fnmatchcase(name, pat) for pat in PREVIEW_SECRET_NAMES) and not name.endswith(".pub")


def _preview_secret(path):
    return _preview_secret_path(path) or _preview_secret_path(os.path.realpath(path))


def cmd_preview_file(argv):
    if len(argv) < 1:
        emit({"ok": False, "error": "preview takes one path"})
        return
    path = argv[0]
    if not path.startswith("/") or len(path) > FILES_PATH_CHARS or "\x00" in path:
        emit({"ok": False, "error": "bad path"})
        return

    try:
        info = os.stat(path)
    except OSError:
        emit({"ok": False, "error": "file not found"})
        return

    mime = mimetypes.guess_type(path, strict=False)[0] or ""
    out = {"ok": True, "modified": _preview_time(info.st_mtime), "size": info.st_size}

    if _preview_secret(path):
        emit(dict(out, kind="hidden", description="Folder" if stat.S_ISDIR(info.st_mode) else (mime or "Private file")))
        return

    if stat.S_ISDIR(info.st_mode):
        entries = []
        count = 0
        try:
            with os.scandir(path) as listing:
                for entry in listing:
                    count += 1
                    if count > PREVIEW_DIR_ENTRIES:
                        break
                    try:
                        is_dir = entry.is_dir()
                    except OSError:
                        is_dir = False
                    entries.append({"name": entry.name[:200], "isDir": is_dir, "path": entry.path})
        except OSError:
            emit({"ok": False, "error": "folder cannot be read"})
            return

        entries.sort(key=lambda e: (not e["isDir"], e["name"].lower()))
        emit(dict(out, kind="dir", description="Folder", entries=entries[:PREVIEW_DIR_ENTRIES], count=count))
        return

    if not stat.S_ISREG(info.st_mode):
        emit(dict(out, kind="other", description="Special file"))
        return

    if mime.startswith("image/") and info.st_size <= PREVIEW_IMAGE_BYTES:
        emit(dict(out, kind="image", image=path, description=mime))
        return

    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            raw = os.read(fd, PREVIEW_TEXT_BYTES)
        finally:
            os.close(fd)
    except OSError:
        emit({"ok": False, "error": "file cannot be read"})
        return

    if b"\x00" in raw:
        emit(dict(out, kind="binary", description=mime or "Binary file"))
        return

    text = raw.decode("utf-8", "replace")
    if info.st_size > len(raw):
        text = text.rpartition("\n")[0] or text
    lines = text.split("\n")
    shown = [line.replace("\t", "    ")[:PREVIEW_LINE_CHARS] for line in lines[:PREVIEW_TEXT_LINES]]
    line_count = len(lines) - (1 if lines and lines[-1] == "" else 0)

    emit(dict(out, kind="text", description=mime or "Text", text="\n".join(shown).rstrip("\n"), lines=line_count))


def main():
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "missing command"})
        sys.exit(0)

    cmd = sys.argv[1]
    if cmd == "files":
        cmd_files(sys.argv[2:])
    elif cmd in ("preview", "preview-file"):
        cmd_preview_file(sys.argv[2:])
    else:
        emit({"ok": False, "error": f"unknown command {cmd}"})


if __name__ == "__main__":
    main()
