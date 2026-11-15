import QtQuick
import Quickshell
import Quickshell.Io
import "../core/FileRank.js" as FileRank

Item {
  id: service

  readonly property string helperPath: decodeURIComponent(Qt.resolvedUrl("file-helper.py").toString().replace(/^file:\/\//, ""))

  property var searchCallback: null
  property var previewCallback: null
  property string activeSearchQuery: ""
  property string activeSearchDir: ""
  readonly property bool loading: searchProc.running || previewProc.running

  function cancel() {
    searchCallback = null
    searchDebounce.stop()
    if (searchProc.running) searchProc.running = false
  }

  function search(directory, pattern, callback) {
    cancel()
    activeSearchDir = directory || Quickshell.env("HOME") || "/"
    activeSearchQuery = pattern || ""
    searchCallback = callback

    if (!activeSearchQuery.trim()) {
      callback([])
      return
    }

    searchDebounce.restart()
  }

  function preview(path, callback) {
    previewCallback = callback
    if (!path) {
      if (callback) callback(null)
      return
    }
    if (previewProc.running) previewProc.running = false
    previewProc.command = ["python3", service.helperPath, "preview", path]
    previewProc.running = true
  }

  Timer {
    id: searchDebounce
    interval: 120
    repeat: false
    onTriggered: {
      searchProc.running = false
      searchProc.command = ["python3", service.helperPath, "files", service.activeSearchDir, service.activeSearchQuery]
      searchProc.running = true
    }
  }

  Process {
    id: searchProc
    stdout: StdioCollector {
      onStreamFinished: {
        var cb = service.searchCallback
        service.searchCallback = null
        if (!cb) return
        var result = []
        try {
          var reply = JSON.parse(text)
          if (reply && reply.ok && Array.isArray(reply.files)) {
            result = FileRank.rank(reply.files, service.activeSearchQuery, service.activeSearchDir)
          }
        } catch (e) {
          result = []
        }
        cb(result)
      }
    }
  }

  Process {
    id: previewProc
    stdout: StdioCollector {
      onStreamFinished: {
        var cb = service.previewCallback
        service.previewCallback = null
        if (!cb) return
        var reply = null
        try {
          reply = JSON.parse(text)
        } catch (e) {
          reply = null
        }
        cb(reply)
      }
    }
  }
}
