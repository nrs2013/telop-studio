// End-to-end simulation of /api/dropbox/find against realistic production
// scenarios. Runs the same classification logic the server uses, with a
// synthetic Dropbox catalog designed to cover every edge case that could
// have silently mis-linked a track in the April 2026 incident.
//
// Run: npx tsx server/dropboxFindSim.test.ts
//
// Every scenario spells out exactly what the *correct* behavior is. A
// scenario fails if the matcher returns the wrong outcome OR returns the
// wrong path in a "unique" case.

import assert from "node:assert/strict";
import { findExactMatches, type DropboxEntry } from "./dropboxMatch";

type Scenario = {
  name: string;
  catalog: DropboxEntry[];
  query: string;
  expect:
    | { kind: "unique"; path: string }
    | { kind: "ambiguous"; paths: string[] }
    | { kind: "none" };
};

// Realistic-looking Dropbox catalog, mixing user folders that TELOP's
// production configuration creates.
const BASE_CATALOG: DropboxEntry[] = [
  // Sakurazaka
  { name: "Alter ego.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/Alter ego.wav" },
  { name: "Addiction.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/Addiction.wav" },
  { name: "流れ弾.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/流れ弾.wav" },
  { name: "桜色.mp3", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/桜色.mp3" },
  // Hinatazaka
  { name: "君しか勝たん.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/HINATAZAKA/君しか勝たん.wav" },
  { name: "アザトカワイイ.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/HINATAZAKA/アザトカワイイ.wav" },
  // Other / special content
  { name: "OPENING.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/OPENING.wav" },
  { name: "DXTEEN_OPENING_MIX.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/DXTEEN_OPENING_MIX.wav" },
  { name: "OPENING_v2.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/OPENING_v2.wav" },
  { name: "ending.mp3", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/ending.mp3" },
  // Legacy location with same filename — this is the "ambiguous" trap
  { name: "OPENING.wav", path: "/Telop音源/OTHER/OPENING.wav" },
  // Near-misses (same name, different preset folder)
  { name: "SE1.wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/SE1.wav" },
  { name: "SE1.wav", path: "/Telop音源/OTHER/SE1.wav" },
  // Songs with varied casing / punctuation
  { name: "I Will Be.mp3", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/I Will Be.mp3" },
  { name: "Nagareyama_V3 (Remaster).wav", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/Nagareyama_V3 (Remaster).wav" },
];

const scenarios: Scenario[] = [
  // ========== Happy path ==========
  {
    name: "real song in the expected folder (Alter ego)",
    catalog: BASE_CATALOG,
    query: "Alter ego.wav",
    expect: { kind: "unique", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/Alter ego.wav" },
  },
  {
    name: "Japanese song name (流れ弾) with extension",
    catalog: BASE_CATALOG,
    query: "流れ弾.wav",
    expect: { kind: "unique", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/流れ弾.wav" },
  },
  {
    name: "Japanese song name without extension (桜色)",
    catalog: BASE_CATALOG,
    query: "桜色",
    expect: { kind: "unique", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/桜色.mp3" },
  },

  // ========== The original bug reproduction ==========
  {
    name: "query 'OPENING' MUST NOT silently pick DXTEEN_OPENING_MIX",
    catalog: BASE_CATALOG,
    query: "OPENING",
    expect: {
      kind: "ambiguous",
      paths: [
        "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/OPENING.wav",
        "/Telop音源/OTHER/OPENING.wav",
      ],
    },
  },
  {
    name: "query 'OPENING_v2' goes to exactly the v2 file",
    catalog: BASE_CATALOG,
    query: "OPENING_v2",
    expect: { kind: "unique", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/OPENING_v2.wav" },
  },
  {
    name: "substring 'DXTEEN' alone never matches anything that isn't exactly DXTEEN",
    catalog: BASE_CATALOG,
    query: "DXTEEN",
    expect: { kind: "none" },
  },

  // ========== Case / punctuation variations ==========
  {
    name: "case-insensitive (opening matches OPENING)",
    catalog: BASE_CATALOG,
    query: "opening",
    expect: {
      kind: "ambiguous",
      paths: [
        "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/OPENING.wav",
        "/Telop音源/OTHER/OPENING.wav",
      ],
    },
  },
  {
    name: "ending (lowercase in catalog) matches exactly",
    catalog: BASE_CATALOG,
    query: "Ending",
    expect: { kind: "unique", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/ending.mp3" },
  },
  {
    name: "filename with parentheses / version markers",
    catalog: BASE_CATALOG,
    query: "Nagareyama_V3 (Remaster)",
    expect: { kind: "unique", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/Nagareyama_V3 (Remaster).wav" },
  },

  // ========== Duplicate across legacy + new folder ==========
  {
    name: "SE1 exists in both legacy and new → ambiguous, not auto-pick",
    catalog: BASE_CATALOG,
    query: "SE1",
    expect: {
      kind: "ambiguous",
      paths: [
        "/nrs チーム フォルダ/NEW TELOP/Telop音源/OTHER/SE1.wav",
        "/Telop音源/OTHER/SE1.wav",
      ],
    },
  },

  // ========== Unicode / normalization corner cases ==========
  {
    name: "decomposed kana query still matches precomposed (ガ vs カ+゛)",
    catalog: [{ name: "ガーデン.wav", path: "/x/ガーデン.wav" }],
    query: "カ\u3099ーデン",
    expect: { kind: "unique", path: "/x/ガーデン.wav" },
  },
  {
    name: "full-width digits are NOT treated as half-width",
    catalog: [{ name: "track01.wav", path: "/x/track01.wav" }],
    query: "track０１",
    expect: { kind: "none" },
  },
  {
    name: "hiragana is NOT treated as katakana",
    catalog: [{ name: "さくら.wav", path: "/x/さくら.wav" }],
    query: "サクラ",
    expect: { kind: "none" },
  },

  // ========== Query sanitation ==========
  {
    name: "query with whole path → none (callers must pass basenames)",
    catalog: BASE_CATALOG,
    query: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/Alter ego.wav",
    expect: { kind: "none" },
  },
  {
    name: "empty query → none",
    catalog: BASE_CATALOG,
    query: "",
    expect: { kind: "none" },
  },
  {
    name: "whitespace-only query → none",
    catalog: BASE_CATALOG,
    query: "   ",
    expect: { kind: "none" },
  },
  {
    name: "tabs/newlines in query are trimmed",
    catalog: BASE_CATALOG,
    query: "\t Alter ego \n",
    expect: { kind: "unique", path: "/nrs チーム フォルダ/NEW TELOP/Telop音源/SAKURAZAKA/Alter ego.wav" },
  },

  // ========== Empty / edge catalog ==========
  {
    name: "empty catalog → none",
    catalog: [],
    query: "anything",
    expect: { kind: "none" },
  },
];

let pass = 0, fail = 0;
for (const sc of scenarios) {
  const outcome = findExactMatches(sc.query, sc.catalog);
  try {
    if (sc.expect.kind === "unique") {
      assert.equal(outcome.kind, "unique", `expected unique, got ${outcome.kind}`);
      if (outcome.kind === "unique") {
        assert.equal(outcome.match.path, sc.expect.path, `path mismatch: ${outcome.match.path}`);
      }
    } else if (sc.expect.kind === "ambiguous") {
      assert.equal(outcome.kind, "ambiguous", `expected ambiguous, got ${outcome.kind}`);
      if (outcome.kind === "ambiguous") {
        const actualPaths = outcome.candidates.map(c => c.path).sort();
        const expected = [...sc.expect.paths].sort();
        assert.deepEqual(actualPaths, expected, `candidate set mismatch\n  got: ${actualPaths.join(", ")}\n  want: ${expected.join(", ")}`);
      }
    } else if (sc.expect.kind === "none") {
      assert.equal(outcome.kind, "none", `expected none, got ${outcome.kind}`);
    }
    console.log(`  ✓ ${sc.name}`);
    pass++;
  } catch (e: any) {
    console.log(`  ✗ ${sc.name}`);
    console.log(`    → ${e.message}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
