// Hand-rolled unit tests for dropboxMatch.ts. Executed via:
//   npx tsx server/dropboxMatch.test.ts
//
// No test framework is pulled in just for this — node's built-in
// assertions are enough to lock down the matching rules. Every failure
// prints which case broke and halts. If you add a recipe, add the case
// here first and verify locally before merging.
//
// Every case represents a real-world edge we need the matcher to get
// right (or refuse to guess on) to avoid re-introducing the wrong-song
// linking bug from the April 2026 incident.

import assert from "node:assert/strict";
import { findExactMatches, normalizeAudioName, type DropboxEntry } from "./dropboxMatch";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ✗ ${name}`);
    console.log(`    → ${e?.message || e}`);
    failed++;
  }
}

// ---------- normalizeAudioName ----------
console.log("normalizeAudioName");

test("lowercases ASCII", () => {
  assert.equal(normalizeAudioName("OPENING"), "opening");
});
test("strips .wav/.mp3/.m4a/.flac etc", () => {
  assert.equal(normalizeAudioName("song.wav"), "song");
  assert.equal(normalizeAudioName("song.mp3"), "song");
  assert.equal(normalizeAudioName("song.M4A"), "song");
  assert.equal(normalizeAudioName("song.Flac"), "song");
  assert.equal(normalizeAudioName("song.AIFF"), "song");
  assert.equal(normalizeAudioName("song.opus"), "song");
});
test("keeps intermediate dots (song.v2.mp3 → song.v2)", () => {
  assert.equal(normalizeAudioName("song.v2.mp3"), "song.v2");
});
test("trims surrounding whitespace", () => {
  assert.equal(normalizeAudioName("  OPENING.wav  "), "opening");
  assert.equal(normalizeAudioName("\tOPENING.wav\n"), "opening");
});
test("NFC normalizes precomposed vs decomposed", () => {
  const decomposed = "カ" + "\u3099"; // カ + combining voiced mark
  const precomposed = "ガ";
  assert.equal(normalizeAudioName(decomposed), normalizeAudioName(precomposed));
});
test("empty/whitespace-only stays empty", () => {
  assert.equal(normalizeAudioName(""), "");
  assert.equal(normalizeAudioName("   "), "");
  assert.equal(normalizeAudioName("\t\n"), "");
});
test("does NOT strip non-audio extensions", () => {
  assert.equal(normalizeAudioName("song.docx"), "song.docx");
  assert.equal(normalizeAudioName("song.txt"), "song.txt");
});

// ---------- findExactMatches ----------
console.log("\nfindExactMatches");

const catalog: DropboxEntry[] = [
  // 1 exact match possible
  { name: "愛の詩.wav", path: "/Telop音源/SAKURAZAKA/愛の詩.wav" },
  // 2 duplicate exact-name matches in different folders (legacy + new)
  { name: "OPENING.wav", path: "/Telop音源/OTHER/OPENING.wav" },
  { name: "OPENING.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/OPENING.wav" },
  // Substring traps
  { name: "DXTEEN_OPENING_MIX.wav", path: "/Telop音源/OTHER/DXTEEN_OPENING_MIX.wav" },
  { name: "OPENING_2.wav", path: "/Telop音源/OTHER/OPENING_2.wav" },
  // Case / extension / space variations
  { name: "Nagareyama.MP3", path: "/Telop音源/SAKURAZAKA/Nagareyama.MP3" },
  { name: " Trailing Space .wav", path: "/Telop音源/OTHER/ Trailing Space .wav" },
  // Songs with dots in name
  { name: "track.v2.mp3", path: "/Telop音源/OTHER/track.v2.mp3" },
  // Near-miss kana (dakuten)
  { name: "ガーデン.wav", path: "/Telop音源/OTHER/ガーデン.wav" },
];

test("unique exact match on exact filename", () => {
  const r = findExactMatches("愛の詩.wav", catalog);
  assert.equal(r.kind, "unique");
  if (r.kind === "unique") assert.equal(r.match.path, "/Telop音源/SAKURAZAKA/愛の詩.wav");
});
test("unique match on basename-only query (no extension)", () => {
  const r = findExactMatches("愛の詩", catalog);
  assert.equal(r.kind, "unique");
});
test("case-insensitive ASCII", () => {
  const r = findExactMatches("nagareyama", catalog);
  assert.equal(r.kind, "unique");
});
test("extension mismatch still matches (compares basenames)", () => {
  const r = findExactMatches("nagareyama.wav", catalog);
  // Query normalized to "nagareyama"; catalog "Nagareyama.MP3" → "nagareyama". Match.
  assert.equal(r.kind, "unique");
});
test("substring NEVER matches — the original bug", () => {
  const r = findExactMatches("OPENING", catalog);
  // Should be ambiguous (2 exact "OPENING.wav"), NOT pick DXTEEN_OPENING_MIX.wav
  assert.equal(r.kind, "ambiguous");
  if (r.kind === "ambiguous") {
    assert.equal(r.candidates.length, 2);
    assert.ok(r.candidates.every(c => /\/OPENING\.wav$/.test(c.path)));
  }
});
test("no match for a substring query that lacks any exact equivalent", () => {
  const r = findExactMatches("DXTEEN", catalog);
  assert.equal(r.kind, "none");
});
test("no match for totally unrelated query", () => {
  const r = findExactMatches("NeverGonnaGiveYouUp", catalog);
  assert.equal(r.kind, "none");
});
test("empty query gets none", () => {
  assert.equal(findExactMatches("", catalog).kind, "none");
  assert.equal(findExactMatches("   ", catalog).kind, "none");
});
test("NFC decomposed kana matches precomposed file", () => {
  const decomposedQuery = "カ" + "\u3099" + "ーデン";
  const r = findExactMatches(decomposedQuery, catalog);
  assert.equal(r.kind, "unique");
});
test("trailing/leading space is normalized", () => {
  const r = findExactMatches("Trailing Space", catalog);
  assert.equal(r.kind, "unique");
});
test("query with embedded dots respects them", () => {
  // "track" should NOT match "track.v2" — different basenames
  const rPartial = findExactMatches("track", catalog);
  assert.equal(rPartial.kind, "none");
  const rFull = findExactMatches("track.v2", catalog);
  assert.equal(rFull.kind, "unique");
});
test("ambiguous query returns ALL candidates, not just first", () => {
  const r = findExactMatches("OPENING.wav", catalog);
  assert.equal(r.kind, "ambiguous");
  if (r.kind === "ambiguous") {
    assert.equal(r.candidates.length, 2);
  }
});
test("duplicate paths across sources collapse to one entry", () => {
  const withDupe: DropboxEntry[] = [
    { name: "song.wav", path: "/A/song.wav", source: "list" },
    { name: "song.wav", path: "/A/song.wav", source: "search" }, // same path, different source
    { name: "song.wav", path: "/B/song.wav", source: "search" },
  ];
  const r = findExactMatches("song", withDupe);
  assert.equal(r.kind, "ambiguous");
  if (r.kind === "ambiguous") {
    assert.equal(r.candidates.length, 2, "/A/song.wav and /B/song.wav — the duplicate same-path entry collapses");
  }
});
test("entries with missing name/path are skipped", () => {
  const sparse: DropboxEntry[] = [
    { name: "", path: "/broken/1" } as any,
    { name: "song.wav", path: "" } as any,
    { name: "song.wav", path: "/ok/song.wav" },
  ];
  const r = findExactMatches("song", sparse);
  assert.equal(r.kind, "unique");
  if (r.kind === "unique") assert.equal(r.match.path, "/ok/song.wav");
});
test("0-entry catalog returns none", () => {
  assert.equal(findExactMatches("anything", []).kind, "none");
});
test("hiragana vs katakana — NOT considered equal (strict)", () => {
  // Intentional: あいうえお and アイウエオ are different names in Japanese.
  // If users mis-name their files, the system should NOT silently convert.
  const cat: DropboxEntry[] = [{ name: "さくら.wav", path: "/t/さくら.wav" }];
  const rk = findExactMatches("サクラ", cat);
  assert.equal(rk.kind, "none");
});
test("full-width vs half-width digits — NOT equal (strict)", () => {
  const cat: DropboxEntry[] = [{ name: "track01.wav", path: "/t/track01.wav" }];
  const r = findExactMatches("track０１", cat);
  assert.equal(r.kind, "none");
});
test("leading folder in query should NOT be stripped automatically", () => {
  // Query must be a basename, not a path. If the user accidentally passes
  // a path, we don't silently match. Callers are expected to pass basenames.
  const cat: DropboxEntry[] = [{ name: "愛の詩.wav", path: "/Telop音源/SAKURAZAKA/愛の詩.wav" }];
  const r = findExactMatches("/Telop音源/SAKURAZAKA/愛の詩.wav", cat);
  assert.equal(r.kind, "none");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
