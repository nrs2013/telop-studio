// Strict filename matching for Dropbox auto-link recovery.
//
// Background: TELOP STUDIO re-links audio tracks to Dropbox files when an
// existing track's blob is missing. The previous implementation used
// substring matching (.includes) and returned the first hit from an
// unordered list. That silently linked the wrong song whenever the query
// name was a substring of another filename (e.g. asking for "OPENING"
// matched "DXTEEN_OPENING_MIX.wav"). Users lost their clip without any
// warning.
//
// Correctness rules enforced here:
//
//   1. Normalize both sides identically before comparison:
//      - Unicode NFC (precomposed CJK) so ガ ≠ カ + ゛ no longer holds
//      - locale-aware lowercase (ja-JP) for consistent kana/alpha case
//      - strip the audio extension (we're matching basenames, not paths)
//      - trim leading/trailing whitespace
//
//   2. Only exact equality of the normalized basename counts as a match.
//      No substring, no edit-distance, no fuzzy scoring.
//
//   3. When multiple files across sources have the same normalized name,
//      DO NOT pick one. Report them all and let the caller (UI) disambiguate.
//
//   4. When zero candidates match, report that plainly. Never fall back.
//
// The module is pure (no network, no filesystem, no I/O) so it can be
// exercised with a synthetic catalog. Tests live in dropboxMatch.test.ts.

export const AUDIO_EXTENSION_RE = /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff|aif|opus)$/i;

export function normalizeAudioName(s: string): string {
  if (!s) return "";
  // Two trims bracket the extension strip: the outer one removes whitespace
  // hugging the filename as given, and the inner one removes whitespace
  // that was LEFT BEHIND between the basename and the extension
  // (e.g. "  Trailing Space .wav" → "Trailing Space .wav" → "Trailing Space "
  //  → "Trailing Space"). Without the second trim, such files never match
  // a query the user types without the accidental inner space.
  return s
    .normalize("NFC")
    .trim()
    .replace(AUDIO_EXTENSION_RE, "")
    .trim()
    .toLocaleLowerCase("ja-JP");
}

export type DropboxEntry = {
  name: string;
  path: string;
  size?: number;
  source?: string;
};

export type MatchOutcome =
  | { kind: "none"; query: string; normalizedQuery: string }
  | { kind: "unique"; query: string; normalizedQuery: string; match: DropboxEntry }
  | { kind: "ambiguous"; query: string; normalizedQuery: string; candidates: DropboxEntry[] };

/**
 * Match `query` against `entries` using strict normalized equality.
 *
 * Duplicate paths across multiple sources are collapsed to one entry
 * (first occurrence wins for source-tag attribution). The result is
 * classified as none (0), unique (1), or ambiguous (2+).
 */
export function findExactMatches(query: string, entries: DropboxEntry[]): MatchOutcome {
  const normalizedQuery = normalizeAudioName(query);
  if (!normalizedQuery) {
    return { kind: "none", query, normalizedQuery };
  }
  const seen = new Map<string, DropboxEntry>();
  for (const e of entries) {
    if (!e || !e.name || !e.path) continue;
    if (normalizeAudioName(e.name) !== normalizedQuery) continue;
    if (!seen.has(e.path)) seen.set(e.path, e);
  }
  const matches = Array.from(seen.values());
  if (matches.length === 0) return { kind: "none", query, normalizedQuery };
  if (matches.length === 1) return { kind: "unique", query, normalizedQuery, match: matches[0] };
  return { kind: "ambiguous", query, normalizedQuery, candidates: matches };
}

/**
 * Tokenize a filename for fuzzy comparison: split by punctuation/whitespace,
 * normalize, drop empty tokens. Used by findFuzzyMatches below.
 *
 * Example: "ANTHEM TIME-ドローン旋回中v.3.mp3"
 *   → ["anthem", "time", "ドローン旋回中v", "3"]
 */
export function tokenizeForFuzzy(name: string): string[] {
  if (!name) return [];
  const normalized = name
    .normalize("NFC")
    .trim()
    .replace(AUDIO_EXTENSION_RE, "")
    .toLocaleLowerCase("ja-JP");
  // Split by typical separators that show up in filenames.
  // Includes ASCII punctuation/whitespace AND Japanese brackets/punctuation.
  return normalized
    .split(/[\s\-_.()[\]{}【】〜~,、。!?！？/\\:;＆&'"`]+/)
    .filter(t => t.length > 0);
}

/**
 * Find fuzzy candidates for `query` among `entries` when the strict
 * matcher returns nothing. Returns up to `maxResults` entries scored
 * by token overlap.
 *
 * Important: this is intended for SUGGESTING candidates to the user,
 * not for auto-linking. The caller MUST present these as choices and
 * never silently link to one. (See the historical OPENING/DXTEEN_OPENING
 * substring incident — that's why exact match owns the auto-link path.)
 *
 * Scoring rule: token-level overlap with a small bonus for shared
 * 3+ char substrings. Stable tie-break by entry.name length so shorter
 * (less noisy) names sort first when scores tie.
 */
export function findFuzzyMatches(
  query: string,
  entries: DropboxEntry[],
  maxResults: number = 8
): DropboxEntry[] {
  const queryTokens = tokenizeForFuzzy(query);
  if (queryTokens.length === 0) return [];

  type Scored = { entry: DropboxEntry; score: number; matched: number };
  const scored: Scored[] = [];
  const seenPath = new Set<string>();

  for (const e of entries) {
    if (!e || !e.name || !e.path) continue;
    if (seenPath.has(e.path)) continue;
    const entryTokens = tokenizeForFuzzy(e.name);
    if (entryTokens.length === 0) continue;
    let matched = 0;
    for (const qt of queryTokens) {
      for (const et of entryTokens) {
        if (
          qt === et ||
          (qt.length >= 3 && et.includes(qt)) ||
          (et.length >= 3 && qt.includes(et))
        ) {
          matched++;
          break; // count each query token at most once
        }
      }
    }
    if (matched === 0) continue;
    // Score = ratio of query tokens hit. Caps at 1.0.
    const score = matched / queryTokens.length;
    scored.push({ entry: e, score, matched });
    seenPath.add(e.path);
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.matched - a.matched ||
      a.entry.name.length - b.entry.name.length
  );

  return scored.slice(0, maxResults).map(s => s.entry);
}
