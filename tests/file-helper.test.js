const test = require("node:test")
const assert = require("node:assert")
const { execFileSync } = require("node:child_process")
const path = require("node:path")
const fs = require("node:fs")
const os = require("node:os")

const HELPER = path.join(__dirname, "../services/file-helper.py")

function runHelper(...args) {
  const stdout = execFileSync("python3", [HELPER, ...args], {
    encoding: "utf-8",
    timeout: 5000
  })
  return JSON.parse(stdout)
}

test("helper files command finds files matching pattern", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-file-test-"))
  try {
    fs.writeFileSync(path.join(tmp, "apple.txt"), "hello apple")
    fs.writeFileSync(path.join(tmp, "banana.log"), "hello banana")
    fs.mkdirSync(path.join(tmp, "sub"))
    fs.writeFileSync(path.join(tmp, "sub", "apple-sub.md"), "hello sub apple")

    const res = runHelper("files", tmp, "apple")
    assert.strictEqual(res.ok, true)
    assert.strictEqual(Array.isArray(res.files), true)
    assert.strictEqual(res.files.length, 2)

    const names = res.files.map(f => f.name).sort()
    assert.deepStrictEqual(names, ["apple-sub.md", "apple.txt"])
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("helper files command handles multi-term query with AND semantics", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-file-test-"))
  try {
    fs.writeFileSync(path.join(tmp, "report-final.xlsx"), "data")
    fs.writeFileSync(path.join(tmp, "report-draft.docx"), "data")
    fs.writeFileSync(path.join(tmp, "notes.xlsx"), "data")

    const res = runHelper("files", tmp, "report xlsx")
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.files.length, 1)
    assert.strictEqual(res.files[0].name, "report-final.xlsx")
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("helper preview command handles directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-file-test-"))
  try {
    fs.writeFileSync(path.join(tmp, "file1.txt"), "content")
    fs.mkdirSync(path.join(tmp, "dir1"))

    const res = runHelper("preview", tmp)
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.kind, "dir")
    assert.strictEqual(Array.isArray(res.entries), true)
    assert.strictEqual(res.entries.length, 2)
    assert.strictEqual(res.entries[0].isDir, true) // dirs sorted first
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("helper preview command handles text files safely", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-file-test-"))
  try {
    const file = path.join(tmp, "sample.txt")
    fs.writeFileSync(file, "Line 1\nLine 2\nLine 3\n")

    const res = runHelper("preview", file)
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.kind, "text")
    assert.strictEqual(res.lines, 3)
    assert.match(res.text, /Line 1/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("helper preview command masks secret and credential files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-file-test-"))
  try {
    const envFile = path.join(tmp, ".env")
    fs.writeFileSync(envFile, "SECRET_KEY=supersecret")

    const res = runHelper("preview", envFile)
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.kind, "hidden")
    assert.strictEqual(res.text, undefined)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("helper preview command detects binary files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omacast-file-test-"))
  try {
    const binFile = path.join(tmp, "sample.bin")
    fs.writeFileSync(binFile, Buffer.from([0x00, 0x01, 0x02, 0xff]))

    const res = runHelper("preview", binFile)
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.kind, "binary")
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
