// Ranks file/folder results from services/file-helper.py's `files` command.
//
// Match tiers:
//   6: Exact match
//   5: Prefix match
//   4: Word boundary match (after separator or camelCase)
//   3: Substring match
//   2: Acronym match
//   1: Residual match

var FILE_TIER_EXACT = 6
var FILE_TIER_PREFIX = 5
var FILE_TIER_WORD = 4
var FILE_TIER_SUBSTRING = 3
var FILE_TIER_METADATA = 2
var FILE_TIER_RESIDUAL = 1
var FILE_TIER_STEP = 10000

// Prefix gap shrinks the gap between EXACT and PREFIX so shallow, nearly
// complete queries (e.g. "Download" -> ~/Downloads) outrank deeply buried
// exact matches in caches or build artifacts (e.g. ~/.cargo/.../download).
var FILE_PREFIX_GAP = 200

function tierBase(tier) {
  if (tier === FILE_TIER_PREFIX) return FILE_TIER_EXACT * FILE_TIER_STEP - FILE_PREFIX_GAP
  return tier * FILE_TIER_STEP
}

function extractAcronym(name) {
  var orig = String(name || "")
  var acronym = ""
  for (var i = 0; i < orig.length; i++) {
    var ch = orig.charAt(i)
    if (/[A-Z]/.test(ch)) acronym += ch.toLowerCase()
  }
  if (acronym.length < 2) {
    var parts = orig.split(/[^a-zA-Z0-9]+/)
    acronym = ""
    for (var j = 0; j < parts.length; j++) {
      if (parts[j]) acronym += parts[j].charAt(0).toLowerCase()
    }
  }
  return acronym
}

function nameTier(name, term) {
  var orig = String(name || "")
  var n = orig.toLowerCase()
  var t = String(term || "").toLowerCase()
  if (!t) return FILE_TIER_RESIDUAL
  if (n === t) return FILE_TIER_EXACT
  if (n.indexOf(t) === 0) return FILE_TIER_PREFIX
  var idx = n.indexOf(t)
  if (idx < 0) {
    var acronym = extractAcronym(orig)
    return acronym && acronym.indexOf(t) >= 0 ? FILE_TIER_METADATA : FILE_TIER_RESIDUAL
  }
  var prev = n.charAt(idx - 1)
  return /[a-z0-9]/i.test(prev) ? FILE_TIER_SUBSTRING : FILE_TIER_WORD
}

function matchTier(name, terms) {
  var tier = FILE_TIER_EXACT
  for (var i = 0; i < terms.length; i++) {
    tier = Math.min(tier, nameTier(name, terms[i]))
  }
  return tier
}

function pathPenalty(dir, name, searchRoot) {
  var base = String(searchRoot || "").replace(/\/+$/, "")
  var d = String(dir || "")
  var rel = d.indexOf(base) === 0 ? d.slice(base.length) : d
  var segments = rel.split("/").filter(function(s) { return s.length > 0 })
  var hiddenAncestor = segments.some(function(s) { return s.charAt(0) === "." })
  var hiddenName = String(name || "").charAt(0) === "."
  var penalty = segments.length * 150 + (hiddenAncestor ? 1500 : 0) + (hiddenName ? 500 : 0)
  return Math.min(penalty, FILE_TIER_STEP - 1)
}

function rank(list, pattern, searchRoot, maxTerms) {
  var cleanPattern = String(pattern || "").replace(/^>\s*/, "")
  var terms = cleanPattern.split(/\s+/).filter(function(s) { return s.length > 0 })
  if (maxTerms > 0) terms = terms.slice(0, maxTerms)
  var browsing = terms.length === 0 || (terms.length === 1 && terms[0] === ".")
  var scored = (list || []).map(function(f) {
    var tier = browsing ? FILE_TIER_EXACT : matchTier(f.name, terms)
    var penalty = pathPenalty(f.dir, f.name, searchRoot)
    return { f: f, score: tierBase(tier) - penalty }
  })
  scored.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score
    var an = (a.f.path || "").toLowerCase()
    var bn = (b.f.path || "").toLowerCase()
    if (an !== bn) return an < bn ? -1 : 1
    var ao = a.f.path || ""
    var bo = b.f.path || ""
    if (ao < bo) return -1
    if (ao > bo) return 1
    return 0
  })
  return scored.map(function(s) { return s.f })
}

if (typeof module !== "undefined") {
  module.exports = {
    nameTier: nameTier,
    matchTier: matchTier,
    pathPenalty: pathPenalty,
    rank: rank,
    FILE_TIER_EXACT: FILE_TIER_EXACT,
    FILE_TIER_PREFIX: FILE_TIER_PREFIX,
    FILE_TIER_WORD: FILE_TIER_WORD,
    FILE_TIER_SUBSTRING: FILE_TIER_SUBSTRING,
    FILE_TIER_METADATA: FILE_TIER_METADATA,
    FILE_TIER_RESIDUAL: FILE_TIER_RESIDUAL,
    FILE_TIER_STEP: FILE_TIER_STEP,
    FILE_PREFIX_GAP: FILE_PREFIX_GAP
  }
}
