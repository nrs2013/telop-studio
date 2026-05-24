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
 * "意味のある（significant）" トークンの判定：
 *   - 純粋な数字単体（"3", "44k16" の中の "3" 単独）は除外。バージョン尾や _3 等のサフィックスで
 *     関係ない曲とマッチしてしまうため。
 *   - 2 文字以下の短すぎる token も除外（"v", "ft" 等の補助語が誤マッチを起こす）。
 *   - 漢字・ひらがな・カタカナを含む token は短くても残す（日本語の「あ」など 1 文字でも意味語）。
 *
 * これで「ANTHEM TIME ドローン旋回中v.3」を検索したときに、
 * 「確信的クロワッサン_3」「Second Jump_44k16_3」が末尾「3」だけで誤候補化する事故を防ぐ。
 */
function isSignificantToken(t: string): boolean {
  if (!t) return false;
  // 数字のみは捨てる（曲のバージョン尾やトラック番号は識別子としては弱すぎる）
  if (/^\d+$/.test(t)) return false;
  // CJK（漢字・ひらがな・カタカナ）を含むなら短くても意味語として保持
  if (/[぀-ヿ一-鿿]/.test(t)) return true;
  // ASCII / ラテン文字は 3 文字以上ないと識別力が弱い
  return t.length >= 3;
}

/**
 * Find fuzzy candidates for `query` among `entries` when the strict
 * matcher returns nothing. Returns up to `maxResults` entries scored
 * by significant-token overlap.
 *
 * Important: this is intended for SUGGESTING candidates to the user,
 * not for auto-linking. The caller MUST present these as choices and
 * never silently link to one. (See the historical OPENING/DXTEEN_OPENING
 * substring incident — that's why exact match owns the auto-link path.)
 *
 * Scoring rule:
 *   - significant tokens のみで token-level overlap を計算
 *   - score = matched / significantQueryTokens.length
 *   - MIN_SCORE 未満の候補は捨てる（無関係な雑音候補を除外）
 *   - 同点時は entry name の短い方を優先（ノイズの少ない名前を上位に）
 */
// 半分以上の意味のあるトークンが一致しないと候補に出さない。
// 0.4 でも誤候補が出ることが確認されたため 0.5 に引き上げ。
const MIN_FUZZY_SCORE = 0.5;

export function findFuzzyMatches(
  query: string,
  entries: DropboxEntry[],
  maxResults: number = 8
): DropboxEntry[] {
  const rawQueryTokens = tokenizeForFuzzy(query);
  const queryTokens = rawQueryTokens.filter(isSignificantToken);
  // 意味のある token がゼロ（数字とバージョン記号しかない query）→ fuzzy 不可
  if (queryTokens.length === 0) return [];

  type Scored = { entry: DropboxEntry; score: number; matched: number };
  const scored: Scored[] = [];
  const seenPath = new Set<string>();

  for (const e of entries) {
    if (!e || !e.name || !e.path) continue;
    if (seenPath.has(e.path)) continue;
    const rawEntryTokens = tokenizeForFuzzy(e.name);
    const entryTokens = rawEntryTokens.filter(isSignificantToken);
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
    // Score = ratio of significant query tokens hit. Caps at 1.0.
    const score = matched / queryTokens.length;
    if (score < MIN_FUZZY_SCORE) continue; // 関係薄い候補を除外
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

/**
 * 内部 score 付き fuzzy match。auto-relink で「top vs 2nd の差で自動採用判定」に使う。
 */
export function findFuzzyMatchesScored(
  query: string,
  entries: DropboxEntry[],
  maxResults: number = 8
): Array<{ entry: DropboxEntry; score: number; matched: number }> {
  const rawQueryTokens = tokenizeForFuzzy(query);
  const queryTokens = rawQueryTokens.filter(isSignificantToken);
  if (queryTokens.length === 0) return [];

  const scored: Array<{ entry: DropboxEntry; score: number; matched: number }> = [];
  const seenPath = new Set<string>();

  for (const e of entries) {
    if (!e || !e.name || !e.path) continue;
    if (seenPath.has(e.path)) continue;
    const rawEntryTokens = tokenizeForFuzzy(e.name);
    const entryTokens = rawEntryTokens.filter(isSignificantToken);
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
          break;
        }
      }
    }
    if (matched === 0) continue;
    const score = matched / queryTokens.length;
    if (score < MIN_FUZZY_SCORE) continue;
    scored.push({ entry: e, score, matched });
    seenPath.add(e.path);
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.matched - a.matched ||
      a.entry.name.length - b.entry.name.length
  );

  return scored.slice(0, maxResults);
}
