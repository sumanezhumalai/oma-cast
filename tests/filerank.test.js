const test = require("node:test")
const assert = require("node:assert")
const FileRank = require("../core/FileRank.js")

test("nameTier scores match quality correctly", () => {
  assert.strictEqual(FileRank.nameTier("download", "download"), FileRank.FILE_TIER_EXACT)
  assert.strictEqual(FileRank.nameTier("Downloads", "down"), FileRank.FILE_TIER_PREFIX)
  assert.strictEqual(FileRank.nameTier("my-download", "download"), FileRank.FILE_TIER_WORD)
  assert.strictEqual(FileRank.nameTier("my_file", "file"), FileRank.FILE_TIER_WORD)
  assert.strictEqual(FileRank.nameTier("mycustomdownload", "download"), FileRank.FILE_TIER_SUBSTRING)
  assert.strictEqual(FileRank.nameTier("ProjectManagementJournal", "pmj"), FileRank.FILE_TIER_METADATA)
  assert.strictEqual(FileRank.nameTier("unrelated", "xyz"), FileRank.FILE_TIER_RESIDUAL)
})

test("matchTier takes the worst term tier", () => {
  assert.strictEqual(
    FileRank.matchTier("report.xlsx", ["report", "xls"]),
    FileRank.FILE_TIER_WORD // .xlsx after dot is a word boundary for xls
  )
})

test("pathPenalty calculates depth and hidden penalties", () => {
  const root = "/home/user"
  // 1 segment below root
  const shallow = FileRank.pathPenalty("/home/user/Documents", "Documents", root)
  assert.strictEqual(shallow, 1 * 150)

  // 3 segments below root with hidden ancestor
  const hiddenAncestor = FileRank.pathPenalty("/home/user/.config/app/sub", "sub", root)
  assert.strictEqual(hiddenAncestor, 3 * 150 + 1500)

  // Hidden file
  const dotFile = FileRank.pathPenalty("/home/user", ".bashrc", root)
  assert.strictEqual(dotFile, 0 + 500)
})

test("prefix gap allows shallow prefix match to beat buried exact match", () => {
  const root = "/home/user"
  const items = [
    {
      id: "deep",
      path: "/home/user/.cargo/registry/src/github.com/cache/download",
      name: "download",
      dir: "/home/user/.cargo/registry/src/github.com/cache",
      isDir: true
    },
    {
      id: "shallow",
      path: "/home/user/Downloads",
      name: "Downloads",
      dir: "/home/user",
      isDir: true
    }
  ]

  // User types "Download"
  const ranked = FileRank.rank(items, "Download", root)
  assert.strictEqual(ranked[0].id, "shallow")
  assert.strictEqual(ranked[1].id, "deep")
})

test("rank handles deterministic tie-breaking", () => {
  const root = "/home/user"
  const items = [
    { id: "b", path: "/home/user/beta.txt", name: "beta.txt", dir: "/home/user", isDir: false },
    { id: "a", path: "/home/user/alpha.txt", name: "alpha.txt", dir: "/home/user", isDir: false }
  ]

  const ranked = FileRank.rank(items, "txt", root)
  assert.strictEqual(ranked[0].id, "a")
  assert.strictEqual(ranked[1].id, "b")
})
