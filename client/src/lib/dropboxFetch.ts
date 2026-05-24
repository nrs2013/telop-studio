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

import { getDropboxClient, isDropboxLoggedIn } from "./dropboxAuth";
import {
  findExactMatches,
  findFuzzyMatches,
  findFuzzyMatchesScored,
  type DropboxEntry,
} from "../../../shared/dropboxMatch";

let installed = false;

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
    return null;
  }
};

// /api/dropbox/find?fileName=... ─── 音源検索
const handleFind: Handler = async (url) => {
  const fileName = url.searchParams.get("fileName") || "";
  if (!fileName) return jsonResponse({ message: "fileName required" }, 400);

  const entries: DropboxEntry[] = [];

  // 1) Telop音源 配下を listing から
  const listing = await listTelopAudioRecursive();
  for (const e of listing) {
    entries.push({ name: e.name, path: e.path, size: e.size, source: "telop-ongen-list" });
  }

  // 2) Dropbox global search で広めに拾う
  try {
    const dbx = await getDropboxClient();
    if (dbx) {
      const baseQuery = fileName.replace(/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff|aif|opus)$/i, "");
      const sr: any = await dbx.filesSearchV2({
        query: baseQuery,
        options: { max_results: 100, file_status: "active", filename_only: true },
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
    return jsonResponse({
      found: false,
      ambiguous: true,
      candidates: outcome.candidates,
      normalizedQuery: outcome.normalizedQuery,
    });
  }
  const suggestions = findFuzzyMatches(fileName, entries, 8);
  return jsonResponse({
    found: false,
    ambiguous: false,
    candidates: [],
    suggestions,
    normalizedQuery: outcome.normalizedQuery,
  });
};

// /api/dropbox/auto-relink?fileName=...&preset=... ─── 自動リンク
const handleAutoRelink: Handler = async (url) => {
  const fileName = url.searchParams.get("fileName") || "";
  const preset = url.searchParams.get("preset") || "";
  if (!fileName) return jsonResponse({ message: "fileName required" }, 400);

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

// ─── path → handler ディスパッチ ───
function pickHandler(url: URL): Handler | null {
  const p = url.pathname;
  if (p === "/api/dropbox/download") return handleDownload;
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
