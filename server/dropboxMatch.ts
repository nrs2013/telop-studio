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
