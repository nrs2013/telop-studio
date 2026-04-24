import { Dropbox } from 'dropbox';
import { db } from './db';
import { dropboxTokens } from '@shared/schema';
import { eq } from 'drizzle-orm';

// ─── Custom OAuth (self-managed refresh token) ───────────────────────────────
// Requires DROPBOX_APP_KEY + DROPBOX_APP_SECRET environment variables and a
// refresh token stored in the database (obtained via the in-app OAuth flow).
// The refresh token has no expiry; access tokens are auto-refreshed.

const APP_KEY = () => process.env.DROPBOX_APP_KEY?.trim();
const APP_SECRET = () => process.env.DROPBOX_APP_SECRET?.trim();

function useCustomOAuth(): boolean {
  return !!(APP_KEY() && APP_SECRET());
}

// ── In-memory cache ────────────────────────────────────────────────────────────
let tokenCache: { accessToken: string; expiresAt: number } | null = null;

function invalidateDropboxCache() {
  tokenCache = null;
}

// ── Custom OAuth: refresh access token using stored refresh token ──────────────
async function refreshWithStoredToken(refreshToken: string): Promise<string> {
  const resp = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: APP_KEY()!,
      client_secret: APP_SECRET()!,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Dropbox token refresh failed (${resp.status}): ${body}`);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error('Dropbox token refresh: no access_token in response');

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 14400) * 1000 - 60_000);
  tokenCache = { accessToken: data.access_token, expiresAt: expiresAt.getTime() };

  await db.update(dropboxTokens)
    .set({ accessToken: data.access_token, expiresAt, updatedAt: new Date() })
    .where(eq(dropboxTokens.id, 'default'));

  return data.access_token;
}

// ── Custom OAuth: get access token (from cache → DB → refresh) ─────────────────
async function getAccessTokenCustom(): Promise<string> {
  // 1. In-memory cache
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  // 2. Load from DB
  const [stored] = await db.select().from(dropboxTokens).where(eq(dropboxTokens.id, 'default'));

  if (!stored?.refreshToken) {
    throw new Error('Dropbox not connected: no refresh token stored. Please reconnect Dropbox from the settings.');
  }

  // 3. Access token still valid?
  if (stored.accessToken && stored.expiresAt && stored.expiresAt.getTime() > Date.now()) {
    tokenCache = { accessToken: stored.accessToken, expiresAt: stored.expiresAt.getTime() };
    return stored.accessToken;
  }

  // 4. Refresh using stored refresh token
  return refreshWithStoredToken(stored.refreshToken);
}

// ── Unified access token getter ────────────────────────────────────────────────
// カスタム OAuth フロー (DROPBOX_APP_KEY + DROPBOX_APP_SECRET + DB 永続化した refresh token) 必須。
async function getAccessToken(): Promise<string> {
  if (!useCustomOAuth()) {
    throw new Error(
      "Dropbox is not configured. Set DROPBOX_APP_KEY and DROPBOX_APP_SECRET environment variables and connect Dropbox via the app settings."
    );
  }
  return getAccessTokenCustom();
}

// ── 401 retry wrapper ──────────────────────────────────────────────────────────
// Retries once on 401 (clears cached access token first). Caps at one retry to
// avoid infinite loops when the refresh token itself is invalid.
async function withDropboxRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status || err?.error?.status;
    const msg = String(err?.message || '');
    const is401 =
      status === 401 ||
      msg.includes('401') ||
      msg.includes('invalid_access_token') ||
      msg.includes('expired_access_token');

    if (is401) {
      console.warn('[Dropbox] 401 received — invalidating cache and retrying');
      invalidateDropboxCacheFull();
      return await fn();
    }

    throw err;
  }
}

// ─── Shared folder / team folder namespace resolution ──────────────────────────
// Dropbox Business のチームフォルダはホーム名前空間に存在しないため、
// sharing/list_folders API でフォルダごとの namespace_id を取得してアクセスする。
// キャッシュ: { フォルダ名（小文字）→ shared_folder_id }

type SharedFolderInfo = { nsId: string; lowerName: string; displayName: string };
let cachedSharedFolders: SharedFolderInfo[] | null = null;

async function fetchSharedFolders(accessToken: string): Promise<SharedFolderInfo[]> {
  if (cachedSharedFolders) return cachedSharedFolders;
  const results: SharedFolderInfo[] = [];
  try {
    let cursor: string | undefined;
    // 最初のページ
    let resp = await fetch('https://api.dropboxapi.com/2/sharing/list_folders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100 }),
    });
    if (!resp.ok) {
      console.warn('[Dropbox] sharing/list_folders failed:', resp.status, await resp.text());
      return results;
    }
    let data: any = await resp.json();
    for (const entry of (data.entries || [])) {
      if (entry.shared_folder_id) {
        results.push({ nsId: entry.shared_folder_id, lowerName: (entry.name || '').toLowerCase(), displayName: entry.name || '' });
      }
    }
    cursor = data.cursor;
    // ページネーション
    while (cursor && data.has_more_items) {
      resp = await fetch('https://api.dropboxapi.com/2/sharing/list_folders/continue', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursor }),
      });
      if (!resp.ok) break;
      data = await resp.json();
      for (const entry of (data.entries || [])) {
        if (entry.shared_folder_id) {
          results.push({ nsId: entry.shared_folder_id, lowerName: (entry.name || '').toLowerCase(), displayName: entry.name || '' });
        }
      }
      cursor = data.cursor;
    }
    console.log('[Dropbox] Shared folders:', results.map(f => `${f.displayName}(ns=${f.nsId})`).join(', '));
    cachedSharedFolders = results;
  } catch (err: any) {
    console.warn('[Dropbox] fetchSharedFolders error:', err.message);
  }
  return results;
}

// パスの各階層のフォルダ名を順番に共有フォルダ一覧と照合し、
// マッチした階層を基点とする namespace_id + 相対パスを返す。
// 例1: "/nrs チーム フォルダ/NEW TELOP/Telop音源/..." → "NEW TELOP" がshared folder
//       → { nsId: <NEW TELOPのns>, relativePath: "/Telop音源/..." }
// 例2: "/NEW TELOP/Telop音源/..." も同様に解決できる
//
// 注: Dropbox Business の team space に置かれている「チームフォルダ」は
// sharing/list_folders では拾えないため、ユーザーが join している共有フォルダ
// （team spaceの下の NEW TELOP など）をヒットさせて基点にする。
async function resolvePathNamespace(
  dropboxPath: string,
  accessToken: string
): Promise<{ nsId: string; relativePath: string } | null> {
  const parts = dropboxPath.replace(/^\//, '').split('/');
  if (parts.length < 2) return null; // トップレベルファイルは namespace 不要

  const folders = await fetchSharedFolders(accessToken);

  // 深いレベルから順に照合して、一番近い共有フォルダを基点にする
  // （浅い階層 "nrs チーム フォルダ" は team space で sharing にはないため
  //   深い "NEW TELOP" を基点にしたい）
  for (let i = Math.min(parts.length - 1, 3); i >= 0; i--) {
    const candidate = parts[i].toLowerCase();
    const match = folders.find(f => f.lowerName === candidate);
    if (match) {
      // 末尾まで一致した場合(相対パスが空)は Dropbox の list_folder に空文字を渡す必要があるので
      // "" にする。それ以外は "/<sub>/<sub>..." の形。
      const rest = parts.slice(i + 1).join('/');
      const relative = rest ? '/' + rest : '';
      console.log(`[Dropbox] Resolved "${parts[i]}" (level ${i}) → namespace ${match.nsId}, relative: "${relative}"`);
      return { nsId: match.nsId, relativePath: relative };
    }
  }
  return null;
}

function buildPathRootHeader(nsId: string): string {
  return JSON.stringify({ '.tag': 'namespace_id', 'namespace_id': nsId });
}

function invalidateDropboxCacheFull() {
  tokenCache = null;
  cachedSharedFolders = null;
}

// ─── Public exports ────────────────────────────────────────────────────────────

export async function getUncachableDropboxClient(): Promise<Dropbox> {
  const accessToken = await getAccessToken();
  return new Dropbox({ accessToken });
}

export async function getTeamDropboxClient(): Promise<Dropbox> {
  const accessToken = await getAccessToken();
  // namespace は download/search 側で個別に処理するため SDK には渡さない
  return new Dropbox({ accessToken });
}

const NEW_TELOP_ROOT = '/nrs チーム フォルダ/NEW TELOP';
const BASE_FOLDER = `${NEW_TELOP_ROOT}/Telop音源`;

function getPresetFolder(preset: string): string {
  switch (preset) {
    case 'sakurazaka': return `${BASE_FOLDER}/SAKURAZAKA`;
    case 'hinatazaka': return `${BASE_FOLDER}/HINATAZAKA`;
    default: return `${BASE_FOLDER}/OTHER`;
  }
}

export async function ensureDropboxFolder(preset: string): Promise<string> {
  return withDropboxRetry(async () => {
    const dbx = await getTeamDropboxClient();
    const folderPath = getPresetFolder(preset);
    try {
      await dbx.filesGetMetadata({ path: folderPath });
    } catch (err: any) {
      if (err?.error?.error_summary?.includes('path/not_found')) {
        try { await dbx.filesCreateFolderV2({ path: NEW_TELOP_ROOT, autorename: false }); } catch {}
        try { await dbx.filesCreateFolderV2({ path: BASE_FOLDER, autorename: false }); } catch {}
        await dbx.filesCreateFolderV2({ path: folderPath, autorename: false });
      } else {
        throw err;
      }
    }
    return folderPath;
  });
}

export async function checkDropboxFileExists(
  preset: string,
  fileName: string
): Promise<{ exists: boolean; path: string; suggestedName?: string }> {
  return withDropboxRetry(async () => {
    const dbx = await getTeamDropboxClient();
    const folderPath = await ensureDropboxFolder(preset);
    const targetPath = `${folderPath}/${fileName}`;
    try {
      await dbx.filesGetMetadata({ path: targetPath });
      const baseName = fileName.replace(/\.mp3$/i, '');
      let counter = 2;
      while (true) {
        const candidatePath = `${folderPath}/${baseName}_${counter}.mp3`;
        try {
          await dbx.filesGetMetadata({ path: candidatePath });
          counter++;
        } catch (checkErr: any) {
          if (checkErr?.error?.error_summary?.includes('path/not_found')) {
            return { exists: true, path: targetPath, suggestedName: `${baseName}_${counter}.mp3` };
          }
          throw checkErr;
        }
      }
    } catch (err: any) {
      if (err?.error?.error_summary?.includes('path/not_found')) {
        return { exists: false, path: targetPath };
      }
      throw err;
    }
  });
}

export async function uploadToDropbox(
  fileBuffer: Buffer,
  preset: string,
  fileName: string,
  mode: 'overwrite' | 'rename' | 'auto' = 'auto'
): Promise<string> {
  return withDropboxRetry(async () => {
    const dbx = await getTeamDropboxClient();
    const folderPath = await ensureDropboxFolder(preset);
    let targetPath = `${folderPath}/${fileName}`;

    const CHUNK_SIZE = 8 * 1024 * 1024;

    const doUpload = async (path: string, uploadMode: { '.tag': string }) => {
      if (fileBuffer.length <= CHUNK_SIZE) {
        const result = await dbx.filesUpload({ path, mode: uploadMode as any, contents: fileBuffer });
        return result.result.path_display || path;
      }
      const sessionStart = await dbx.filesUploadSessionStart({ contents: fileBuffer.slice(0, CHUNK_SIZE) });
      const sessionId = sessionStart.result.session_id;
      let offset = CHUNK_SIZE;
      while (offset + CHUNK_SIZE < fileBuffer.length) {
        await dbx.filesUploadSessionAppendV2({ cursor: { session_id: sessionId, offset }, contents: fileBuffer.slice(offset, offset + CHUNK_SIZE) });
        offset += CHUNK_SIZE;
      }
      const result = await dbx.filesUploadSessionFinish({
        cursor: { session_id: sessionId, offset },
        commit: { path, mode: uploadMode as any },
        contents: fileBuffer.slice(offset),
      });
      return result.result.path_display || path;
    };

    if (mode === 'overwrite') {
      return doUpload(targetPath, { '.tag': 'overwrite' });
    }

    // rename/auto: find unique name
    try {
      await dbx.filesGetMetadata({ path: targetPath });
      const baseName = fileName.replace(/\.mp3$/i, '');
      let counter = 2;
      while (true) {
        const candidatePath = `${folderPath}/${baseName}_${counter}.mp3`;
        try {
          await dbx.filesGetMetadata({ path: candidatePath });
          counter++;
        } catch (checkErr: any) {
          if (checkErr?.error?.error_summary?.includes('path/not_found')) {
            targetPath = candidatePath;
            break;
          }
          throw checkErr;
        }
      }
    } catch (err: any) {
      if (!err?.error?.error_summary?.includes('path/not_found')) throw err;
    }

    return doUpload(targetPath, { '.tag': 'add' });
  });
}

async function rawDownload(accessToken: string, filePath: string, nsId?: string): Promise<{ ok: boolean; status: number; buffer?: Buffer; body?: string }> {
  const apiArg = JSON.stringify({ path: filePath })
    .replace(/[\u0080-\uFFFF]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Dropbox-API-Arg': apiArg,
  };
  if (nsId) headers['Dropbox-API-Path-Root'] = buildPathRootHeader(nsId);
  const resp = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers });
  if (resp.ok) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { ok: true, status: resp.status, buffer };
  }
  const body = await resp.text();
  return { ok: false, status: resp.status, body };
}

/**
 * Streaming counterpart of downloadFromDropbox.
 *
 * The buffer-based function below loads the whole file into RAM before
 * returning. That's fine for small files (lyrics docs, a few hundred KB of
 * JSON) but a 30 MB WAV swamps Railway's container memory and — worse —
 * blocks the request until the entire download finishes, so MP3 conversion
 * and upload to the browser happen strictly *after* the Dropbox download
 * completes. End-to-end time was roughly additive.
 *
 * This variant resolves the same namespace / shared-folder logic and then
 * returns the still-open fetch Response object, so callers can pipe its
 * body straight into ffmpeg's stdin (or the HTTP response) while bytes
 * are still arriving from Dropbox. Downloads now overlap with transcoding
 * and network upload.
 */
export async function downloadFromDropboxStream(dropboxPath: string): Promise<{ response: Response; contentLength: number | null }> {
  return withDropboxRetry(async () => {
    const accessToken = await getAccessToken();
    const apiArg = JSON.stringify({ path: dropboxPath })
      .replace(/[\u0080-\uFFFF]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const baseHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': apiArg,
    };

    // Attempt direct download from home namespace first.
    let resp = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: baseHeaders });
    if (resp.ok) {
      const cl = resp.headers.get('content-length');
      return { response: resp, contentLength: cl ? parseInt(cl, 10) : null };
    }

    // 409 (path/not_found) → try shared-folder namespace resolution, same
    // algorithm as the buffer variant.
    if (resp.status === 409) {
      // Drain the failed response body to free the socket.
      await resp.arrayBuffer().catch(() => {});
      const resolved = await resolvePathNamespace(dropboxPath, accessToken);
      if (resolved) {
        const nsHeaders = {
          ...baseHeaders,
          'Dropbox-API-Arg': JSON.stringify({ path: resolved.relativePath })
            .replace(/[\u0080-\uFFFF]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`),
          'Dropbox-API-Path-Root': buildPathRootHeader(resolved.nsId),
        };
        const nsResp = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: nsHeaders });
        if (nsResp.ok) {
          const cl = nsResp.headers.get('content-length');
          return { response: nsResp, contentLength: cl ? parseInt(cl, 10) : null };
        }
        const body = await nsResp.text();
        const err = new Error(`Response failed with a ${nsResp.status} code: ${body}`);
        (err as any).status = nsResp.status;
        throw err;
      }

      // Last resort: root_namespace_id
      const acct = await new Dropbox({ accessToken }).usersGetCurrentAccount();
      const rootNsId = (acct.result as any)?.root_info?.root_namespace_id;
      if (rootNsId) {
        const rootHeaders = { ...baseHeaders, 'Dropbox-API-Path-Root': buildPathRootHeader(String(rootNsId)) };
        const rootResp = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: rootHeaders });
        if (rootResp.ok) {
          const cl = rootResp.headers.get('content-length');
          return { response: rootResp, contentLength: cl ? parseInt(cl, 10) : null };
        }
      }
    }

    const body = await resp.text().catch(() => '');
    const err = new Error(`Response failed with a ${resp.status} code: ${body}`);
    (err as any).status = resp.status;
    throw err;
  });
}

export async function downloadFromDropbox(dropboxPath: string): Promise<Buffer> {
  return withDropboxRetry(async () => {
    const accessToken = await getAccessToken();
    console.log(`[Dropbox] Downloading: "${dropboxPath}"`);

    // 1) まずホーム名前空間で直接ダウンロード試行
    const direct = await rawDownload(accessToken, dropboxPath);
    if (direct.ok && direct.buffer) {
      console.log(`[Dropbox] Direct download OK: "${dropboxPath}"`);
      return direct.buffer;
    }
    console.log(`[Dropbox] Direct download HTTP ${direct.status}, trying shared folder namespace...`);

    // 2) 409 (not_found) の場合: sharing/list_folders で top-level フォルダの namespace を探す
    if (direct.status === 409) {
      const resolved = await resolvePathNamespace(dropboxPath, accessToken);
      if (resolved) {
        const nsResult = await rawDownload(accessToken, resolved.relativePath, resolved.nsId);
        if (nsResult.ok && nsResult.buffer) {
          console.log(`[Dropbox] Namespace download OK: ns=${resolved.nsId} path="${resolved.relativePath}"`);
          return nsResult.buffer;
        }
        console.error(`[Dropbox] Namespace download HTTP ${nsResult.status}: ${nsResult.body}`);
        const err = new Error(`Response failed with a ${nsResult.status} code: ${nsResult.body}`);
        (err as any).status = nsResult.status;
        throw err;
      }
      // sharing にも見つからない場合は root_namespace_id を試す (fallback)
      const acct = await new Dropbox({ accessToken }).usersGetCurrentAccount();
      const rootNsId = (acct.result as any)?.root_info?.root_namespace_id;
      if (rootNsId) {
        const rootResult = await rawDownload(accessToken, dropboxPath, String(rootNsId));
        if (rootResult.ok && rootResult.buffer) {
          console.log(`[Dropbox] Root-namespace download OK: ns=${rootNsId}`);
          return rootResult.buffer;
        }
        console.error(`[Dropbox] Root-namespace download HTTP ${rootResult.status}: ${rootResult.body}`);
      }
    }

    const err = new Error(`Response failed with a ${direct.status} code: ${direct.body}`);
    (err as any).status = direct.status;
    throw err;
  });
}

export async function searchDropboxFiles(
  query: string,
  extensions?: string[]
): Promise<{ name: string; path: string; size: number }[]> {
  return withDropboxRetry(async () => {
    const accessToken = await getAccessToken();

    const doSearch = async (nsId?: string): Promise<{ name: string; path: string; size: number; nsId?: string }[]> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };
      if (nsId) headers['Dropbox-API-Path-Root'] = buildPathRootHeader(nsId);
      const resp = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, options: { max_results: 20 } }),
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      const found: { name: string; path: string; size: number; nsId?: string }[] = [];
      for (const match of (data.matches || [])) {
        const metadata = match?.metadata?.metadata;
        if (!metadata || metadata['.tag'] !== 'file') continue;
        const name = metadata.name || '';
        const filePath = metadata.path_display || metadata.path_lower || '';
        const size = metadata.size || 0;
        if (extensions && extensions.length > 0) {
          const ext = name.split('.').pop()?.toLowerCase() || '';
          if (!extensions.includes(ext)) continue;
        }
        found.push({ name, path: filePath, size, nsId });
      }
      return found;
    };

    // 1) ホーム名前空間で検索
    const homeResults = await doSearch();
    if (homeResults.length > 0) {
      console.log(`[Dropbox] Search "${query}" (home) → ${homeResults.length} results`);
      return homeResults;
    }

    // 2) 共有フォルダの各 namespace で検索
    const sharedFolders = await fetchSharedFolders(accessToken);
    const allResults: { name: string; path: string; size: number }[] = [];
    for (const folder of sharedFolders) {
      const nsResults = await doSearch(folder.nsId);
      for (const r of nsResults) {
        // 相対パスをフルパスに変換
        const fullPath = `/${folder.displayName}${r.path.startsWith('/') ? r.path : '/' + r.path}`;
        allResults.push({ name: r.name, path: fullPath, size: r.size });
      }
    }
    console.log(`[Dropbox] Search "${query}" (shared namespaces) → ${allResults.length} results`);
    return allResults;
  });
}

// ── Diagnostic: browse from root to check folder structure ─────────────────────
export async function diagnoseDrpboxStructure(): Promise<{
  root: string[];
  teamFolder: string[] | null;
  newTelop: string[] | null;
  telopOngen: string[] | null;
}> {
  const dbx = await getTeamDropboxClient();
  const listFolder = async (p: string): Promise<string[] | null> => {
    try {
      const r = await dbx.filesListFolder({ path: p });
      return r.result.entries.map(e => `${e['.tag'] === 'folder' ? '📁' : '📄'} ${e.path_display || e.name}`);
    } catch (err: any) {
      return [`ERROR: ${err?.error?.error_summary || err.message}`];
    }
  };
  const root = await listFolder('') || [];
  const teamFolder = await listFolder('/nrs チーム フォルダ');
  const newTelop = await listFolder('/nrs チーム フォルダ/NEW TELOP');
  const telopOngen = await listFolder('/nrs チーム フォルダ/NEW TELOP/Telop音源');
  return { root, teamFolder, newTelop, telopOngen };
}

export async function listDropboxFiles(
  preset?: string
): Promise<{ name: string; path: string; size: number }[]> {
  return withDropboxRetry(async () => {
    const dbx = await getTeamDropboxClient();
    const folderPath = preset ? getPresetFolder(preset) : BASE_FOLDER;
    const results: { name: string; path: string; size: number }[] = [];

    try {
      let response = await dbx.filesListFolder({ path: folderPath, recursive: !preset });

      for (const entry of response.result.entries) {
        if (entry['.tag'] === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
          results.push({ name: entry.name, path: entry.path_display || entry.path_lower || '', size: (entry as any).size || 0 });
        }
      }

      while (response.result.has_more) {
        response = await dbx.filesListFolderContinue({ cursor: response.result.cursor });
        for (const entry of response.result.entries) {
          if (entry['.tag'] === 'file' && entry.name.toLowerCase().endsWith('.mp3')) {
            results.push({ name: entry.name, path: entry.path_display || entry.path_lower || '', size: (entry as any).size || 0 });
          }
        }
      }
    } catch (err: any) {
      if (err?.error?.error_summary?.includes('path/not_found')) return [];
      throw err;
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function renameInDropbox(fromPath: string, toPath: string): Promise<string> {
  return withDropboxRetry(async () => {
    const dbx = await getTeamDropboxClient();
    const result = await dbx.filesMoveV2({ from_path: fromPath, to_path: toPath, autorename: true });
    return (result.result.metadata as any).path_display || toPath;
  });
}

export async function deleteFromDropbox(dropboxPath: string): Promise<void> {
  return withDropboxRetry(async () => {
    const dbx = await getTeamDropboxClient();
    await dbx.filesDeleteV2({ path: dropboxPath });
  });
}

export async function browseDropboxFolder(
  folderPath: string
): Promise<{ name: string; path: string; type: 'folder' | 'file'; size: number }[]> {
  return withDropboxRetry(async () => {
    const accessToken = await getAccessToken();
    const entries: { name: string; path: string; type: 'folder' | 'file'; size: number }[] = [];

    // パスが共有フォルダ配下かどうか確認
    const ns = folderPath && folderPath !== '/' ? await resolvePathNamespace(folderPath, accessToken) : null;

    const fetchEntries = async (path: string, nsId?: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };
      if (nsId) headers['Dropbox-API-Path-Root'] = buildPathRootHeader(nsId);
      const resp = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers,
        body: JSON.stringify({ path }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        console.error(`[Dropbox] list_folder error ${resp.status}:`, body);
        throw new Error(`Response failed with a ${resp.status} code: ${body}`);
      }
      const data = await resp.json();
      return data.entries || [];
    };

    let rawEntries: any[];
    if (ns) {
      // 共有フォルダ配下: namespace + 相対パス
      rawEntries = await fetchEntries(ns.relativePath, ns.nsId);
    } else {
      const isRoot = !folderPath || folderPath === '/' || folderPath === '';
      let usedTeamSpace = false;

      // ルート表示時: チーム空間 (root_namespace) を優先的に使う
      if (isRoot) {
        try {
          const acct = await new Dropbox({ accessToken }).usersGetCurrentAccount();
          const rootInfo = (acct.result as any)?.root_info;
          const rootNsId = rootInfo?.root_namespace_id;
          const homeNsId = rootInfo?.home_namespace_id;
          // root_namespace_id != home_namespace_id ならチームアカウント
          if (rootNsId && rootNsId !== homeNsId) {
            console.log(`[Dropbox] Team account detected, using team space ns=${rootNsId}`);
            rawEntries = await fetchEntries('', rootNsId);
            usedTeamSpace = true;
          }
        } catch (err: any) {
          console.warn('[Dropbox] Team space lookup failed, falling back to home:', err.message);
        }
      }

      if (!usedTeamSpace) {
        // Business アカウントの場合、Dropbox Web UI は team space を既定で使う。
        // ホーム名前空間では team folder の直接の子は共有済みフォルダしか見えないため、
        // (例: /nrs チーム フォルダ 直下で NEW TELOP だけしか返らない)
        // 非ルートパスは team space 名前空間を先に試す。
        let teamSpaceAttempted = false;
        if (!isRoot && folderPath) {
          try {
            const acct = await new Dropbox({ accessToken }).usersGetCurrentAccount();
            const rootInfo = (acct.result as any)?.root_info;
            const rootNsId = rootInfo?.root_namespace_id;
            const homeNsId = rootInfo?.home_namespace_id;
            if (rootNsId && rootNsId !== homeNsId) {
              teamSpaceAttempted = true;
              console.log(`[Dropbox] Non-root business path, using team space ns=${rootNsId}: "${folderPath}"`);
              rawEntries = await fetchEntries(folderPath, rootNsId);
            }
          } catch (teamErr: any) {
            console.warn(`[Dropbox] Team space attempt failed for "${folderPath}":`, teamErr.message);
            teamSpaceAttempted = false;
          }
        }

        if (!teamSpaceAttempted || !rawEntries) {
          // ルートもしくは team space 未試行/失敗: ホーム名前空間で取得
          rawEntries = await fetchEntries(folderPath || '');
        }
      }

      // ルート表示時: 共有フォルダ一覧を追加(重複は除外)
      if (isRoot) {
        const sharedFolders = await fetchSharedFolders(accessToken);
        const existingNames = new Set(rawEntries.map((e: any) => (e.name || '').toLowerCase()));
        for (const sf of sharedFolders) {
          if (!existingNames.has(sf.lowerName)) {
            entries.push({ name: sf.displayName, path: `/${sf.displayName}`, type: 'folder', size: 0 });
          }
        }
      }
    }

    for (const entry of rawEntries) {
      let entryPath = entry.path_display || entry.path_lower || '';
      // 共有フォルダ配下の場合: 相対パスをフルパスに変換
      if (ns) {
        const topFolder = folderPath.replace(/^\//, '').split('/')[0];
        entryPath = `/${topFolder}${entryPath}`;
      }
      if (entry['.tag'] === 'folder') {
        entries.push({ name: entry.name, path: entryPath, type: 'folder', size: 0 });
      } else if (entry['.tag'] === 'file') {
        entries.push({ name: entry.name, path: entryPath, type: 'file', size: entry.size || 0 });
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ja');
    });
    return entries;
  });
}

export async function checkDropboxConnection(): Promise<{ connected: boolean; method: string }> {
  try {
    const dbx = await getTeamDropboxClient();
    await dbx.usersGetCurrentAccount();
    return { connected: true, method: 'custom' };
  } catch {
    return { connected: false, method: 'none' };
  }
}

// ── OAuth flow helpers (called from routes) ────────────────────────────────────

export function getDropboxAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: APP_KEY() || '',
    response_type: 'code',
    redirect_uri: redirectUri,
    token_access_type: 'offline',
    state,
    scope: [
      'files.content.read',
      'files.content.write',
      'files.metadata.read',
      'files.metadata.write',
      'account_info.read',
      'sharing.read',
    ].join(' '),
  });
  return `https://www.dropbox.com/oauth2/authorize?${params}`;
}

export async function exchangeDropboxCode(code: string, redirectUri: string): Promise<void> {
  const resp = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: APP_KEY()!,
      client_secret: APP_SECRET()!,
      redirect_uri: redirectUri,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OAuth token exchange failed (${resp.status}): ${body}`);
  }

  const data = await resp.json();
  if (!data.refresh_token) throw new Error('No refresh_token in OAuth response. Make sure offline access is requested.');

  const expiresAt = new Date(Date.now() + (data.expires_in ?? 14400) * 1000 - 60_000);

  await db.insert(dropboxTokens).values({
    id: 'default',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: dropboxTokens.id,
    set: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      updatedAt: new Date(),
    },
  });

  // Reset cache so next call uses new token
  invalidateDropboxCache();
  console.log('[Dropbox] Custom OAuth tokens stored successfully');
}

export async function disconnectDropboxCustom(): Promise<void> {
  await db.update(dropboxTokens)
    .set({ accessToken: null, refreshToken: null, expiresAt: null, updatedAt: new Date() })
    .where(eq(dropboxTokens.id, 'default'));
  invalidateDropboxCache();
}

export async function getDropboxOAuthStatus(): Promise<{
  customConfigured: boolean;
  customConnected: boolean;
}> {
  const customConfigured = useCustomOAuth();
  let customConnected = false;

  if (customConfigured) {
    const [stored] = await db.select().from(dropboxTokens).where(eq(dropboxTokens.id, 'default'));
    customConnected = !!(stored?.refreshToken);
  }

  return {
    customConfigured,
    customConnected,
  };
}
