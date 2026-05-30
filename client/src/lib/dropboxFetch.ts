// サーバが居ない環境（GitHub Pages 等）で /api/* 系の fetch を透過的に
// Dropbox JS SDK 経由に振り替える。
//
// 設計：
//   - クライアントコード（project.tsx, audioBulkRelink.ts 等）は fetch のまま無変更
//   - 起動時に installDropboxFetchShim() を 1 回だけ呼ぶ
//   - サーバが居る環境（dev: Express）では shim は素通し（404 / network エラー時だけ Dropbox 直に逃がす）
//   - 既知の endpoint だけハンドルする。他の /api は無干渉
//
// 既存サーバ endpoint との互換性が最重要。レスポンス shape を絶対崩さない。

import { getDropboxClient, isDropboxLoggedIn, handleDbxError } from "./dropboxAuth";
import {
  findExactMatches,
  findFuzzyMatches,
  findFuzzyMatchesScored,
  type DropboxEntry,
} from "../../../shared/dropboxMatch";

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff|aif|opus)$/i;

let installed = false;

// ─── localhost dev サーバ proxy ───
// Pages 上では書き出し（/api/export/*）と mp3 変換（/api/audio/convert-to-mp3）が
// 動かない。しかし、のむさんが Mac で `npm run dev` を起動していれば、Pages の
// UI からでも localhost:5001 に CORS 越しに POST して書き出しできる。
//
// 起動時に一度 probe して、available なら localStorage に flag を立てる。
// flag があれば、書き出し系の fetch はすべて localhost:5001 に rewrite する。

const LS_DEV_PROXY = "telop-dev-proxy-available";
const DEV_PROXY_URLS = ["http://localhost:5001", "http://localhost:5000"];

let probedDevProxy: string | null = null; // 起動後に確定する dev サーバ URL

export async function probeDevProxy(): Promise<string | null> {
  // 同 origin が localhost:* なら proxy 不要
  if (window.location.origin.startsWith("http://localhost")) {
    probedDevProxy = null;
    localStorage.removeItem(LS_DEV_PROXY);
    return null;
  }
  for (const base of DEV_PROXY_URLS) {
    try {
      const res = await fetch(`${base}/api/auth/me`, {
        credentials: "include",
        // 短いタイムアウト：dev サーバ無いとき何秒も待たない
        signal: AbortSignal.timeout(800),
      });
      // 200/401/403 どれでもサーバが居れば available。404 はそのサーバが /api を持ってない。
      if (res.status < 500 && res.status !== 404) {
        probedDevProxy = base;
        localStorage.setItem(LS_DEV_PROXY, base);
        console.log(`[dev-proxy] detected dev server at ${base}`);
        return base;
      }
    } catch {
      // 接続失敗 → 次の候補
    }
  }
  probedDevProxy = null;
  localStorage.removeItem(LS_DEV_PROXY);
  return null;
}

export function getDevProxyUrl(): string | null {
  if (probedDevProxy) return probedDevProxy;
  return localStorage.getItem(LS_DEV_PROXY);
}

// 書き出し系の URL かどうか判定。これに該当する path は dev proxy 経由にする。
function shouldUseDevProxy(pathname: string): boolean {
  return pathname.startsWith("/api/export/") ||
         pathname === "/api/export" ||
         pathname === "/api/audio/convert-to-mp3";
}

// ─── 定数（server/dropbox.ts と一致させる） ───
const NEW_TELOP_ROOT = "/nrs チーム フォルダ/NEW TELOP";
const BASE_FOLDER = `${NEW_TELOP_ROOT}/Telop音源`;

function getPresetFolder(preset: string): string {
  switch (preset) {
    case "sakurazaka":
      return `${BASE_FOLDER}/SAKURAZAKA`;
    case "hinatazaka":
      return `${BASE_FOLDER}/HINATAZAKA`;
    default:
      return `${BASE_FOLDER}/OTHER`;
  }
}

// ─── Telop音源 全体の listing をキャッシュ（重い API なので 5 分有効） ───
type CachedEntry = { name: string; path: string; size: number };
let cachedAudioIndex: { entries: CachedEntry[]; at: number } | null = null;
const INDEX_TTL_MS = 5 * 60 * 1000;

// ─── 最優先フォルダ（のむさん指定の共有フォルダ） ───
// 検索時は、まずこのフォルダ配下を最優先で見る。exact match があれば即採用、
// 無ければ通常の全体検索（global search）にフェイルセーフ。
// shared link は起動時に Dropbox API で resolve して実 path を確定する。
const PRIORITY_SHARED_LINK = "https://www.dropbox.com/scl/fo/o1o8d9arwjt8hulh9r04x/AA_ORtFhcvalOdjVXULYpFw?rlkey=emtrsa0os8sjh0bm1ak8aq534&dl=0";

let priorityFolderPath: string | null = null;
let priorityFolderResolved = false;
let cachedPriorityIndex: { entries: CachedEntry[]; at: number } | null = null;

async function resolvePriorityFolderPath(): Promise<string | null> {
  if (priorityFolderResolved) return priorityFolderPath;
  const dbx = await getDropboxClient();
  if (!dbx) return null;
  try {
    // shared link のメタデータから実 path を取得する。
    const meta: any = await (dbx as any).sharingGetSharedLinkMetadata({ url: PRIORITY_SHARED_LINK });
    const m = meta?.result || meta;
    // path_lower / path_display があれば team scope 内の実 path。
    // 無ければ folder 名で namespace root 直下を仮定（pathRoot 設定済みなので /name で辿れる）。
    // ※ 括弧で優先順位を明示（path_lower → path_display → /name の順）。
    priorityFolderPath = m?.path_lower || m?.path_display || (m?.name ? `/${m.name}` : null);
    priorityFolderResolved = true;
    console.log(`[dbx-fetch] priority folder resolved to: ${priorityFolderPath}`);
    return priorityFolderPath;
  } catch (err) {
    console.warn("[dbx-fetch] priority folder resolve failed:", err);
    priorityFolderResolved = true; // 再試行しない（諦める）
    return null;
  }
}

async function listPriorityFolderAudio(): Promise<CachedEntry[]> {
  if (cachedPriorityIndex && Date.now() - cachedPriorityIndex.at < INDEX_TTL_MS) {
    return cachedPriorityIndex.entries;
  }
  const path = await resolvePriorityFolderPath();
  if (!path) return [];
  const dbx = await getDropboxClient();
  if (!dbx) return [];

  const out: CachedEntry[] = [];
  const audioExt = /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff|aif|opus)$/i;
  try {
    let res: any = await dbx.filesListFolder({
      path,
      recursive: true,
      include_non_downloadable_files: false,
    });
    while (true) {
      for (const entry of res.result.entries) {
        if (entry[".tag"] !== "file") continue;
        const nm: string = entry.name || "";
        if (!audioExt.test(nm)) continue;
        out.push({
          name: nm,
          path: entry.path_display || entry.path_lower || "",
          size: entry.size ?? 0,
        });
      }
      if (!res.result.has_more) break;
      res = await dbx.filesListFolderContinue({ cursor: res.result.cursor });
    }
  } catch (err) {
    console.warn("[dbx-fetch] listPriorityFolderAudio failed:", err);
  }
  cachedPriorityIndex = { entries: out, at: Date.now() };
  console.log(`[dbx-fetch] priority folder index: ${out.length} files cached`);
  return out;
}

async function listTelopAudioRecursive(): Promise<CachedEntry[]> {
  if (cachedAudioIndex && Date.now() - cachedAudioIndex.at < INDEX_TTL_MS) {
    return cachedAudioIndex.entries;
  }
  const dbx = await getDropboxClient();
  if (!dbx) return [];

  const out: CachedEntry[] = [];
  const audioExt =
    /\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff|aif|opus)$/i;

  try {
    let res: any = await dbx.filesListFolder({
      path: BASE_FOLDER,
      recursive: true,
      include_non_downloadable_files: false,
    });
    while (true) {
      for (const entry of res.result.entries) {
        if (entry[".tag"] !== "file") continue;
        const nm: string = entry.name || "";
        if (!audioExt.test(nm)) continue;
        out.push({
          name: nm,
          path: entry.path_display || entry.path_lower || "",
          size: entry.size ?? 0,
        });
      }
      if (!res.result.has_more) break;
      res = await dbx.filesListFolderContinue({ cursor: res.result.cursor });
    }
  } catch (err) {
    console.warn("[dbx-fetch] listTelopAudioRecursive failed:", err);
  }

  cachedAudioIndex = { entries: out, at: Date.now() };
  console.log(`[dbx-fetch] Telop音源 index: ${out.length} files cached`);
  return out;
}

function invalidateAudioIndex() {
  cachedAudioIndex = null;
}

// ─── 個別 endpoint handlers ───
type Handler = (url: URL, init?: RequestInit, input?: RequestInfo | URL) => Promise<Response | null>;

function jsonResponse(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "X-Source": "dbx-shim" },
  });
}

// /api/dropbox/download?path=... ─── audio download
const handleDownload: Handler = async (url) => {
  const path = url.searchParams.get("path");
  if (!path) return jsonResponse({ message: "path required" }, 400);
  const dbx = await getDropboxClient();
  if (!dbx) return null;
  try {
    const res: any = await dbx.filesDownload({ path });
    const blob: Blob = res.result?.fileBlob ?? res.fileBlob;
    if (!blob) return null;
    const lower = (res.result?.name || res.name || path).toLowerCase();
    let contentType = "application/octet-stream";
    if (lower.endsWith(".mp3")) contentType = "audio/mpeg";
    else if (lower.endsWith(".wav")) contentType = "audio/wav";
    else if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) contentType = "audio/mp4";
    else if (lower.endsWith(".flac")) contentType = "audio/flac";
    else if (lower.endsWith(".ogg") || lower.endsWith(".oga")) contentType = "audio/ogg";
    else if (lower.endsWith(".aac")) contentType = "audio/aac";
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "X-Source": "dropbox-direct",
      },
    });
  } catch (err) {
    console.warn("[dbx-fetch] download failed:", err);
    handleDbxError(err); // 401 ならセッション期限切れ通知
    return null;
  }
};

// /api/dropbox/browse?path=... ─── フォルダブラウザ（dropbox-picker.tsx 用）
// レスポンス shape はサーバ互換： { entries: [{name, path, type, size}], path }
// pathRoot が getDropboxClient で team root namespace に設定されているので
// "/nrs チーム フォルダ/..." 等の team space path も filesListFolder で辿れる。
const handleBrowse: Handler = async (url) => {
  const folderPath = url.searchParams.get("path") || "";
  const dbx = await getDropboxClient();
  if (!dbx) return jsonResponse({ message: "Dropbox にログインしていません" }, 401);
  try {
    const entries: Array<{ name: string; path: string; type: "folder" | "file"; size: number }> = [];
    let res: any = await dbx.filesListFolder({
      path: folderPath, // "" = namespace root（チーム全体）
      recursive: false,
      include_non_downloadable_files: true,
    });
    while (true) {
      for (const e of res.result.entries) {
        const tag = e[".tag"];
        if (tag !== "folder" && tag !== "file") continue;
        entries.push({
          name: e.name,
          path: e.path_display || e.path_lower || "",
          type: tag === "folder" ? "folder" : "file",
          size: e.size ?? 0,
        });
      }
      if (!res.result.has_more) break;
      res = await dbx.filesListFolderContinue({ cursor: res.result.cursor });
    }
    // フォルダを先に、その後ファイル。各群は名前順（自然な並び）。
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
    return jsonResponse({ entries, path: folderPath });
  } catch (err: any) {
    console.warn("[dbx-fetch] browse failed:", err);
    if (handleDbxError(err)) {
      return jsonResponse({ message: "Dropbox の再ログインが必要です" }, 401);
    }
    const summary = JSON.stringify(err?.error || "");
    if (summary.includes("path/not_found")) {
      // フォルダが無い → 空扱い（エラーにしない）
      return jsonResponse({ entries: [], path: folderPath });
    }
    return jsonResponse({ message: "フォルダの取得に失敗しました", error: err?.message }, 500);
  }
};

// /api/dropbox/search?q=... ─── Dropbox 全体ファイル検索（dropbox-picker.tsx 用）
// レスポンス shape はサーバ互換： { results: [{name, path, size}] }
const handleSearch: Handler = async (url) => {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return jsonResponse({ results: [] });
  const dbx = await getDropboxClient();
  if (!dbx) return jsonResponse({ message: "Dropbox にログインしていません" }, 401);
  try {
    const results: Array<{ name: string; path: string; size: number }> = [];
    const sr: any = await dbx.filesSearchV2({
      query: q,
      options: { max_results: 100, file_status: "active", filename_only: true } as any,
    });
    const matches = sr?.result?.matches || [];
    for (const m of matches) {
      const md = m?.metadata?.metadata;
      if (!md || md[".tag"] !== "file") continue;
      results.push({
        name: md.name || "",
        path: md.path_display || md.path_lower || "",
        size: md.size ?? 0,
      });
    }
    return jsonResponse({ results });
  } catch (err: any) {
    console.warn("[dbx-fetch] search failed:", err);
    if (handleDbxError(err)) {
      return jsonResponse({ message: "Dropbox の再ログインが必要です" }, 401);
    }
    return jsonResponse({ message: "検索に失敗しました", error: err?.message }, 500);
  }
};

// /api/dropbox/find?fileName=... ─── 音源検索
// 検索戦略（フェイルセーフ二段階）：
//   Phase A: 最優先フォルダ（のむさん指定の共有フォルダ）配下のみで exact match を探す。
//     - 見つかれば即 found:true で確定（global search 不要）
//     - 同名複数（ambiguous）なら priority 内候補だけを返す
//   Phase B: Phase A で exact 0 件 → 全体（priority + Telop音源 listing + global search）
//     から exact / fuzzy 候補を出す
// これで「優先フォルダ内に正解があるとき」は無関係な候補が混ざらない。
const handleFind: Handler = async (url) => {
  const fileName = url.searchParams.get("fileName") || "";
  if (!fileName) return jsonResponse({ message: "fileName required" }, 400);

  // ── Phase A: 最優先フォルダだけで exact match を試す ──
  const priorityEntries: DropboxEntry[] = [];
  const priorityListing = await listPriorityFolderAudio();
  for (const e of priorityListing) {
    priorityEntries.push({ name: e.name, path: e.path, size: e.size, source: "priority-folder" });
  }
  if (priorityEntries.length > 0) {
    const priorityOutcome = findExactMatches(fileName, priorityEntries);
    if (priorityOutcome.kind === "unique") {
      console.log(`[dbx-fetch] find "${fileName}" → priority folder UNIQUE: ${priorityOutcome.match.path}`);
      return jsonResponse({
        found: true,
        path: priorityOutcome.match.path,
        candidates: [priorityOutcome.match],
        normalizedQuery: priorityOutcome.normalizedQuery,
        source: "priority",
      });
    }
    if (priorityOutcome.kind === "ambiguous") {
      // 優先フォルダ内に同名複数 → 全体検索広げず priority 候補だけで dialog 出す
      console.log(`[dbx-fetch] find "${fileName}" → priority folder AMBIGUOUS (${priorityOutcome.candidates.length})`);
      return jsonResponse({
        found: false,
        ambiguous: true,
        candidates: priorityOutcome.candidates,
        normalizedQuery: priorityOutcome.normalizedQuery,
        source: "priority",
      });
    }
    // priority に exact 無し → Phase B に進む
  }

  // ── Phase B: 全体検索 ──
  const entries: DropboxEntry[] = [...priorityEntries]; // priority のは既に source タグ付きで持ってる

  // Telop音源 listing も
  const telopListing = await listTelopAudioRecursive();
  for (const e of telopListing) {
    entries.push({ name: e.name, path: e.path, size: e.size, source: "telop-ongen-list" });
  }

  // Dropbox global search で広めに拾う
  try {
    const dbx = await getDropboxClient();
    if (dbx) {
      const baseQuery = fileName.replace(/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff|aif|opus)$/i, "");
      const sr: any = await dbx.filesSearchV2({
        query: baseQuery,
        options: { max_results: 100, file_status: "active", filename_only: true } as any,
      });
      const matches = sr?.result?.matches || [];
      for (const m of matches) {
        const md = m?.metadata?.metadata;
        if (!md || md[".tag"] !== "file") continue;
        const nm: string = md.name || "";
        if (!/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff|aif|opus)$/i.test(nm)) continue;
        entries.push({
          name: nm,
          path: md.path_display || md.path_lower || "",
          size: md.size ?? 0,
          source: "global-search",
        });
      }
    }
  } catch (err) {
    console.warn("[dbx-fetch] global search failed:", err);
  }

  const outcome = findExactMatches(fileName, entries);
  if (outcome.kind === "unique") {
    return jsonResponse({
      found: true,
      path: outcome.match.path,
      candidates: [outcome.match],
      normalizedQuery: outcome.normalizedQuery,
    });
  }
  if (outcome.kind === "ambiguous") {
    // 候補を priority folder のものを先頭に並べ替え（UI で見やすく）
    const sorted = [...outcome.candidates].sort((a, b) => {
      const aPri = a.source === "priority-folder" ? 0 : 1;
      const bPri = b.source === "priority-folder" ? 0 : 1;
      return aPri - bPri;
    });
    return jsonResponse({
      found: false,
      ambiguous: true,
      candidates: sorted,
      normalizedQuery: outcome.normalizedQuery,
    });
  }
  const suggestions = findFuzzyMatches(fileName, entries, 8);
  // 提案も priority folder のものを優先
  const sortedSuggestions = [...suggestions].sort((a, b) => {
    const aPri = a.source === "priority-folder" ? 0 : 1;
    const bPri = b.source === "priority-folder" ? 0 : 1;
    return aPri - bPri;
  });
  return jsonResponse({
    found: false,
    ambiguous: false,
    candidates: [],
    suggestions: sortedSuggestions,
    normalizedQuery: outcome.normalizedQuery,
  });
};

// /api/dropbox/auto-relink?fileName=...&preset=... ─── 自動リンク
// 検索順位（フェイルセーフ）：
//   1. 最優先フォルダ配下を fuzzy 検索（最も高い基準で採用判定）
//   2. なければ Telop音源/<preset> folder fuzzy
//   3. それでもなければ Telop音源 全体 fuzzy（緩めの基準で）
const handleAutoRelink: Handler = async (url) => {
  const fileName = url.searchParams.get("fileName") || "";
  const preset = url.searchParams.get("preset") || "";
  if (!fileName) return jsonResponse({ message: "fileName required" }, 400);

  // ── Step 1: 最優先フォルダ ──
  const priorityListing = await listPriorityFolderAudio();
  if (priorityListing.length > 0) {
    const priorityEntries: DropboxEntry[] = priorityListing.map(e => ({ name: e.name, path: e.path, size: e.size }));
    const priorityScored = findFuzzyMatchesScored(fileName, priorityEntries, 8);
    if (priorityScored.length > 0) {
      // dedupe
      const seen = new Set<string>();
      const dedup: typeof priorityScored = [];
      for (const s of priorityScored) {
        const base = s.entry.name.toLocaleLowerCase("ja-JP");
        if (seen.has(base)) continue;
        seen.add(base);
        dedup.push(s);
      }
      // 単独 high-confidence → 採用（priority folder の score 0.7 以上）
      if (dedup.length === 1 && dedup[0].score >= 0.7) {
        console.log(`[auto-relink] PRIORITY 単独採用: "${fileName}" → ${dedup[0].entry.path} (score=${dedup[0].score.toFixed(2)})`);
        return jsonResponse({ accepted: true, path: dedup[0].entry.path, name: dedup[0].entry.name, source: "priority" });
      }
      // 複数：top vs 2nd gap で確定判定
      if (dedup.length >= 2) {
        const top = dedup[0];
        const second = dedup[1];
        const gap = top.score - second.score;
        if (top.score >= 0.9 && gap >= 0.3) {
          console.log(`[auto-relink] PRIORITY top 採用: "${fileName}" → ${top.entry.path} (score=${top.score.toFixed(2)}, gap=${gap.toFixed(2)})`);
          return jsonResponse({ accepted: true, path: top.entry.path, name: top.entry.name, source: "priority" });
        }
      }
      // priority 内で確定できない → suggestions 出して手動
      // ただし priority に該当ありなので、Telop音源 fallback は使わず ambiguous で返す
      return jsonResponse({
        accepted: false,
        reason: `priority folder fuzzy ambiguous (${dedup.length} candidates)`,
        suggestions: dedup.map(s => s.entry),
        source: "priority",
      });
    }
    // priority listing あるが fuzzy 0 件 → Step 2 へフェイルオーバー
  }

  // ── Step 2 & 3: 従来の Telop音源 fallback ──
  const listing = await listTelopAudioRecursive();
  if (listing.length === 0) {
    return jsonResponse({ accepted: false, reason: "no index" });
  }

  const presetFolder =
    preset === "sakurazaka" ? "SAKURAZAKA" :
    preset === "hinatazaka" ? "HINATAZAKA" :
    preset === "other" ? "OTHER" : null;

  const entries: DropboxEntry[] = listing.map(e => ({ name: e.name, path: e.path, size: e.size }));
  const filtered = presetFolder
    ? entries.filter(e => e.path.includes(`/Telop音源/${presetFolder}/`))
    : entries;

  if (filtered.length === 0 && presetFolder) {
    return jsonResponse({ accepted: false, reason: `no candidates in preset folder ${presetFolder}` });
  }

  let scored = findFuzzyMatchesScored(fileName, filtered, 8);
  let usedFallback = false;
  if (scored.length === 0 && presetFolder) {
    usedFallback = true;
    scored = findFuzzyMatchesScored(fileName, entries, 8);
  }
  if (scored.length === 0) {
    return jsonResponse({ accepted: false, reason: "no fuzzy match" });
  }

  // basename dedupe
  const seen = new Set<string>();
  const dedup: typeof scored = [];
  for (const s of scored) {
    const base = s.entry.name.toLocaleLowerCase("ja-JP");
    if (seen.has(base)) continue;
    seen.add(base);
    dedup.push(s);
  }

  if (dedup.length === 1) {
    const winner = dedup[0];
    if (usedFallback && winner.score < 0.8) {
      return jsonResponse({
        accepted: false,
        reason: `fallback single hit but score too low (${winner.score.toFixed(2)})`,
        suggestions: dedup.map(s => s.entry),
      });
    }
    return jsonResponse({ accepted: true, path: winner.entry.path, name: winner.entry.name });
  }
  const top = dedup[0];
  const second = dedup[1];
  const gap = top.score - second.score;
  const threshold = usedFallback ? 1.0 : 0.9;
  if (top.score >= threshold && gap >= 0.3) {
    return jsonResponse({ accepted: true, path: top.entry.path, name: top.entry.name });
  }
  return jsonResponse({
    accepted: false,
    reason: `ambiguous (${dedup.length} fuzzy candidates, top=${top.score.toFixed(2)}, 2nd=${second.score.toFixed(2)})`,
    suggestions: dedup.map(s => s.entry),
  });
};

// /api/dropbox/check-exists?preset=...&fileName=... ─── upload 前重複チェック
const handleCheckExists: Handler = async (url) => {
  const preset = url.searchParams.get("preset") || "other";
  const fileName = url.searchParams.get("fileName") || "";
  if (!fileName) return jsonResponse({ message: "fileName required" }, 400);

  const dbx = await getDropboxClient();
  if (!dbx) return null;
  const folderPath = getPresetFolder(preset);
  const targetPath = `${folderPath}/${fileName}`;
  try {
    await dbx.filesGetMetadata({ path: targetPath });
    // 存在 → suggested name を返す
    const base = fileName.replace(/\.mp3$/i, "");
    for (let c = 2; c <= 100; c++) {
      const cand = `${folderPath}/${base}_${c}.mp3`;
      try {
        await dbx.filesGetMetadata({ path: cand });
      } catch (e: any) {
        if (e?.error?.error_summary?.includes("path/not_found")) {
          return jsonResponse({ exists: true, path: targetPath, suggestedName: `${base}_${c}.mp3` });
        }
        throw e;
      }
    }
    return jsonResponse({ exists: true, path: targetPath, suggestedName: `${base}_${Date.now()}.mp3` });
  } catch (e: any) {
    if (e?.error?.error_summary?.includes("path/not_found")) {
      return jsonResponse({ exists: false, path: targetPath });
    }
    console.warn("[dbx-fetch] check-exists error:", e);
    return null;
  }
};

// /api/dropbox/upload ─── 新規音源 upload。
// FormData fields: audio (file), preset, fileName?, mode?
// 注意：サーバは非mp3を ffmpeg で mp3 化していたが、Pages では変換不可なので原本のまま up。
// レスポンス shape はサーバ互換： { dropboxPath, fileName, size }
const handleUpload: Handler = async (_url, init) => {
  if (!init || !init.body || !(init.body instanceof FormData)) return null;
  const fd = init.body as FormData;
  const file = fd.get("audio") ?? fd.get("file");
  const preset = (fd.get("preset") as string) || "other";
  const requestedName = (fd.get("fileName") as string) || (file instanceof File ? file.name : "audio.mp3");
  const mode = (fd.get("mode") as string) || "auto";
  if (!(file instanceof Blob)) return jsonResponse({ message: "audio file required" }, 400);

  const dbx = await getDropboxClient();
  if (!dbx) return null;
  const folderPath = getPresetFolder(preset);
  const targetPath = `${folderPath}/${requestedName}`;
  try {
    const buf = await file.arrayBuffer();
    const validModes: Record<string, string> = { overwrite: "overwrite", rename: "add", auto: "add" };
    const dropboxMode = validModes[mode] || "add";
    const autorename = mode === "auto" || mode === "rename";
    const res: any = await dbx.filesUpload({
      path: targetPath,
      mode: { ".tag": dropboxMode } as any,
      autorename,
      contents: buf,
    });
    invalidateAudioIndex();
    const finalPath = res?.result?.path_display || targetPath;
    const finalName = finalPath.split("/").pop() || requestedName;
    return jsonResponse({ dropboxPath: finalPath, fileName: finalName, size: buf.byteLength });
  } catch (err: any) {
    console.warn("[dbx-fetch] upload failed:", err);
    return jsonResponse({ message: err?.message || "upload failed" }, 500);
  }
};

// /api/dropbox/upload-telop ─── .telop ファイル保存。
// JSON body: { fileName, content (base64), preset }
// レスポンス shape はサーバ互換： { dropboxPath, size }
const handleUploadTelop: Handler = async (_url, init) => {
  let body: any = {};
  try {
    if (init?.body && typeof init.body === "string") body = JSON.parse(init.body);
  } catch {}
  const fileName = body?.fileName as string | undefined;
  const content = body?.content as string | undefined;
  const preset = (body?.preset as string) || "other";
  if (!fileName || !content) return jsonResponse({ message: "fileName and content are required" }, 400);

  const dbx = await getDropboxClient();
  if (!dbx) return null;
  const presetFolder = preset === "sakurazaka" ? "SAKURAZAKA" : preset === "hinatazaka" ? "HINATAZAKA" : "OTHER";
  const telopFolder = `${NEW_TELOP_ROOT}/.telop/${presetFolder}`;
  // フォルダ作成は失敗しても無視（既存ならエラーになる）
  try { await dbx.filesCreateFolderV2({ path: NEW_TELOP_ROOT, autorename: false }); } catch {}
  try { await dbx.filesCreateFolderV2({ path: `${NEW_TELOP_ROOT}/.telop`, autorename: false }); } catch {}
  try { await dbx.filesCreateFolderV2({ path: telopFolder, autorename: false }); } catch {}
  const dropboxPath = `${telopFolder}/${fileName}`;
  try {
    // base64 → Uint8Array
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await dbx.filesUpload({ path: dropboxPath, contents: bytes, mode: { ".tag": "overwrite" } as any });
    return jsonResponse({ dropboxPath, size: bytes.byteLength });
  } catch (err: any) {
    console.warn("[dbx-fetch] upload-telop failed:", err);
    return jsonResponse({ message: err?.message || "upload-telop failed" }, 500);
  }
};

// /api/dropbox/delete  body: { dropboxPath }
const handleDelete: Handler = async (_url, init) => {
  let body: any = {};
  try {
    if (init?.body && typeof init.body === "string") body = JSON.parse(init.body);
  } catch {}
  const path = body?.dropboxPath;
  if (!path) return jsonResponse({ message: "dropboxPath required" }, 400);

  const dbx = await getDropboxClient();
  if (!dbx) return null;
  try {
    await dbx.filesDeleteV2({ path });
    invalidateAudioIndex();
    return jsonResponse({ success: true });
  } catch (err: any) {
    // 既に消えてる → OK 扱い（サーバの挙動と合わせる）
    if (err?.error?.error_summary?.includes("path_lookup/not_found")) {
      return jsonResponse({ success: true, alreadyGone: true });
    }
    console.warn("[dbx-fetch] delete failed:", err);
    return jsonResponse({ message: err?.message || "delete failed" }, 500);
  }
};

// /api/dropbox/rename  body: { fromPath, toPath }
const handleRename: Handler = async (_url, init) => {
  let body: any = {};
  try {
    if (init?.body && typeof init.body === "string") body = JSON.parse(init.body);
  } catch {}
  const fromPath = body?.fromPath;
  const toPath = body?.toPath;
  if (!fromPath || !toPath) return jsonResponse({ message: "fromPath/toPath required" }, 400);

  const dbx = await getDropboxClient();
  if (!dbx) return null;
  try {
    const r: any = await dbx.filesMoveV2({ from_path: fromPath, to_path: toPath, autorename: false });
    invalidateAudioIndex();
    return jsonResponse({ success: true, newPath: r?.result?.metadata?.path_display || toPath });
  } catch (err: any) {
    console.warn("[dbx-fetch] rename failed:", err);
    return jsonResponse({ message: err?.message || "rename failed" }, 500);
  }
};

// /api/dropbox/oauth/status ─── 旧サーバ OAuth 状態。
// Pages では PKCE で client 側に token がある → connected として返す。
const handleOAuthStatus: Handler = async () =>
  jsonResponse({ customConfigured: true, customConnected: isDropboxLoggedIn() });

// /api/dropbox/oauth/disconnect ─── 旧サーバの token DB を消すやつ。
// Pages では localStorage の token を消せばよいが、それは UI 側 (handleDbxSignOut) が担当。
// ここでは「成功」だけ返す。
const handleOAuthDisconnect: Handler = async () => jsonResponse({ success: true });

// /api/editing/status ─── 編集ロック状況（Pages では誰もロック取れない＝常に free）
const handleEditingStatus: Handler = async () => jsonResponse({ active: [], me: null });

// /api/editing/heartbeat, /api/editing/leave ─── no-op
const handleEditingNoop: Handler = async () => jsonResponse({ success: true });

// /api/reading ─── かな読み生成（kuromoji on server）。Pages では諦め。
// レスポンス shape はサーバと一致 { readings: { text → reading } }。
// reading が空文字なら、呼び出し元の fallback（先頭文字 → 50 音グループ）が効く。
const handleReadingNoop: Handler = async (_url, init) => {
  let body: any = {};
  try {
    if (init?.body && typeof init.body === "string") body = JSON.parse(init.body);
  } catch {}
  const texts: string[] = Array.isArray(body?.texts) ? body.texts : Array.isArray(body?.names) ? body.names : [];
  const readings: Record<string, string> = {};
  for (const t of texts) {
    if (typeof t === "string" && t.length > 0) readings[t] = "";
  }
  return jsonResponse({ readings });
};

// /api/audio/convert-to-mp3?ext=.xxx ─── サーバで mp3 変換していたやつ。
// Pages ではクライアント mp3 エンコードが必要。ffmpeg.wasm 未導入のため、
// 暫定で「変換せずそのまま返す」（多くのブラウザは wav/m4a を再生可なのでひとまず動く）。
// .telop ファイル機能が呼ぶケースがほとんどなので、まずは音が出ることを優先。
const handleConvertToMp3Stub: Handler = async (_url, init) => {
  if (!init || !init.body) return jsonResponse({ message: "no body" }, 400);
  // body はバイナリ。受け取ってそのまま返す（content-type は audio/mpeg と偽る）。
  // ※ 本物の mp3 でない場合、サーバ経路と挙動差が出る。あくまで Pages 暫定。
  const data = init.body as ArrayBuffer | Blob;
  const blob = data instanceof Blob ? data : new Blob([data]);
  return new Response(blob, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "X-Source": "dbx-shim-passthrough" },
  });
};

// /api/export/* ─── ビデオ書き出しはサーバ ffmpeg 必須（ffmpeg.wasm 移行は Phase D 未済）。
// Pages では dev サーバが起動していれば自動 proxy するが、ここに来てるということは
// proxy も失敗（dev サーバ停止中）。明示的に「dev サーバを起動して」と返す。
const handleExportUnsupported: Handler = async (url) =>
  jsonResponse({
    message:
      "書き出しには Mac の dev サーバが必要です。Terminal で `cd ~/Projects/telop-studio && npm run dev` を" +
      "実行してから、もう一度「書き出し」を押してください。dev サーバが起動すれば自動で書き出しが始まります。",
    code: "EXPORT_REQUIRES_LOCAL_SERVER",
    path: url.pathname,
  }, 501);

// /api/sync/* も同様 — 既に syncService 側で Dropbox fallback を仕込んだが、
// 念のため pull-all / push 等もここで明示的に 501 を返してログを綺麗にする。
// ※ syncService が先に await checkAuth() で失敗するので、ここはほぼ来ない。
const handleSyncUnsupported: Handler = async (url) =>
  jsonResponse({ message: "Use Dropbox sync instead", path: url.pathname }, 501);

// /api/auth/* も同様 — Pages では Dropbox login が認証担当。
const handleAuthUnsupported: Handler = async (url) =>
  jsonResponse({ message: "Use Dropbox login instead", user: null, path: url.pathname }, 401);

// ─── path → handler ディスパッチ ───
function pickHandler(url: URL): Handler | null {
  const p = url.pathname;
  if (p === "/api/dropbox/download") return handleDownload;
  if (p === "/api/dropbox/browse") return handleBrowse;
  if (p === "/api/dropbox/search") return handleSearch;
  if (p === "/api/dropbox/find") return handleFind;
  if (p === "/api/dropbox/auto-relink") return handleAutoRelink;
  if (p === "/api/dropbox/check-exists") return handleCheckExists;
  if (p === "/api/dropbox/upload") return handleUpload;
  if (p === "/api/dropbox/upload-telop") return handleUploadTelop;
  if (p === "/api/dropbox/delete") return handleDelete;
  if (p === "/api/dropbox/rename") return handleRename;
  if (p === "/api/editing/status") return handleEditingStatus;
  if (p === "/api/editing/heartbeat" || p === "/api/editing/leave") return handleEditingNoop;
  if (p === "/api/reading") return handleReadingNoop;
  if (p === "/api/audio/convert-to-mp3") return handleConvertToMp3Stub;
  if (p === "/api/dropbox/oauth/status") return handleOAuthStatus;
  if (p === "/api/dropbox/oauth/disconnect") return handleOAuthDisconnect;
  // 大分類で潰す（Pages では確実に動かないもの）
  if (p.startsWith("/api/export/")) return handleExportUnsupported;
  if (p.startsWith("/api/sync/")) return handleSyncUnsupported;
  if (p.startsWith("/api/auth/")) return handleAuthUnsupported;
  return null;
}

export function installDropboxFetchShim(): void {
  if (installed) return;
  installed = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    // /api/ で始まる URL だけ shim 対象
    if (!urlStr.includes("/api/")) {
      return origFetch(input, init);
    }

    let parsed: URL;
    try {
      parsed = new URL(urlStr, window.location.origin);
    } catch {
      return origFetch(input, init);
    }

    // ─── dev-proxy 経路：書き出し系は dev サーバ available なら localhost に投げる ───
    // 起動時 probe で見つかった dev サーバ URL に rewrite。Pages の UI から
    // Mac の localhost:5001 に CORS 越しで書き出し依頼が飛ぶ。
    if (shouldUseDevProxy(parsed.pathname)) {
      const proxyBase = getDevProxyUrl();
      if (proxyBase) {
        const proxyUrl = `${proxyBase}${parsed.pathname}${parsed.search}`;
        const proxyInit: RequestInit = { ...(init || {}), credentials: "include" };
        try {
          return await origFetch(proxyUrl, proxyInit);
        } catch (err) {
          console.warn("[dev-proxy] forward failed, falling back to shim:", err);
          // proxy 失敗時：handler に流す（501 が出るので UI に「dev サーバを起動して」が出る）
        }
      }
    }

    const handler = pickHandler(parsed);
    if (!handler) {
      return origFetch(input, init);
    }

    // まずは本物サーバを試す（dev 環境では Express が答える）。
    // 成功すればそれを返す。404 / 502 / 503 / network error のときだけ shim に逃がす。
    try {
      const res = await origFetch(input, init);
      if (res.ok) return res;
      if (res.status === 404 || res.status === 502 || res.status === 503) {
        if (!isDropboxLoggedIn()) return res; // DBX 未ログインなら shim 不能、元レス返す
        const shimRes = await handler(parsed, init, input);
        if (shimRes) return shimRes;
      }
      return res;
    } catch (err) {
      // ネットワーク完全断 or サーバ自体不在
      if (!isDropboxLoggedIn()) throw err;
      const shimRes = await handler(parsed, init, input);
      if (shimRes) return shimRes;
      throw err;
    }
  };

  console.log("[dbx-fetch] fetch shim installed for /api/* endpoints");
}
