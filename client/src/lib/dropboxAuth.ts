// Dropbox OAuth (PKCE flow) — クライアントだけで完結。
//
// 新フロー（PKCE）：
//   クライアント → Dropbox 認証 → クライアント /auth-callback →
//   code + verifier で /oauth2/token → access_token/refresh_token を localStorage 保存
//
// ★ 自動トークン更新（2026-05-30 完備）：
//   Dropbox JS SDK は refreshToken + clientId を渡すと、API 呼び出し前に
//   access_token の期限（5 分バッファ）を自動チェックして更新する。
//   getDropboxClient() で persistent な DropboxAuth を seed することで、
//   4 時間でアクセストークンが切れても透過的に再取得される。
//   refresh_token 自体が死んだ（ユーザーがアプリ連携解除等）場合のみ
//   `dropbox-session-expired` イベントを発火し、UI が再ログインへ誘導する。
//
// ★ チームスペース対応：
//   nrs チーム Dropbox のフォルダ（/nrs チーム フォルダ/... 等）は team space
//   namespace にあるため、pathRoot を root namespace に設定しないと
//   filesListFolder 等の path 指定 API が path/not_found になる。
//   usersGetCurrentAccount の root_info.root_namespace_id を一度だけ取得し、
//   全クライアントに pathRoot として設定する。
//
// 設定要件（Dropbox Developer Console "Telop Studio Lyric Sync nomura" app）：
//   - key=50csjjo4u9fvfxw（nrs アカウント配下、team admin 承認済み）
//   - Allow public clients (PKCE): Allow
//   - Redirect URIs: https://nrs2013.github.io/telop-studio/, localhost:5001/, localhost:5173/

import { Dropbox, DropboxAuth } from "dropbox";

const APP_KEY = "50csjjo4u9fvfxw";

const LS_ACCESS_TOKEN = "telop-dbx-access-token";
const LS_REFRESH_TOKEN = "telop-dbx-refresh-token";
const LS_TOKEN_EXPIRES = "telop-dbx-token-expires";
const LS_CODE_VERIFIER = "telop-dbx-pkce-verifier";
const LS_ROOT_NS = "telop-dbx-root-namespace"; // team root namespace id（チームフォルダ access 用）

// 「セッションが切れた」ことを App 全体へ通知するカスタムイベント名。
// App.tsx がこれを listen して再ログイン UI を出す。
export const DBX_SESSION_EXPIRED_EVENT = "dropbox-session-expired";

// dev / prod 両対応：現在の origin を redirect URI として使う
function getRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin + window.location.pathname;
}

// ─── OAuth 開始用の使い捨て auth client（PKCE verifier 生成用） ───
let _oauthClient: DropboxAuth | null = null;
function getOAuthClient(): DropboxAuth {
  if (_oauthClient) return _oauthClient;
  _oauthClient = new DropboxAuth({
    clientId: APP_KEY,
    fetch: window.fetch.bind(window),
  });
  return _oauthClient;
}

/**
 * 「Dropbox にログイン」ボタンから呼ぶ。
 * PKCE 用の code_verifier を生成して localStorage に保存し、認証 URL に飛ばす。
 */
export async function startDropboxOAuth(): Promise<void> {
  const auth = getOAuthClient();
  const redirectUri = getRedirectUri();
  const authUrl: any = await auth.getAuthenticationUrl(
    redirectUri,
    undefined,
    "code",
    "offline", // refresh_token を要求
    undefined,
    "none",
    true // usePKCE
  );
  const verifier = (auth as any).codeVerifier || auth.getCodeVerifier?.();
  if (verifier) localStorage.setItem(LS_CODE_VERIFIER, verifier);
  window.location.href = String(authUrl);
}

/**
 * Redirect callback で呼ぶ。URL の ?code=... を access_token に交換し、localStorage に保存。
 * 成功したら true を返す。code が無い（ログイン未実施）or 失敗時は false。
 */
export async function handleOAuthCallback(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;

  const verifier = localStorage.getItem(LS_CODE_VERIFIER);
  if (!verifier) {
    console.warn("[dbx-auth] code received but no verifier in storage; ignoring");
    return false;
  }

  const auth = getOAuthClient();
  (auth as any).codeVerifier = verifier;
  auth.setCodeVerifier?.(verifier);

  try {
    const redirectUri = getRedirectUri().split("?")[0];
    const res: any = await auth.getAccessTokenFromCode(redirectUri, code);
    const result = res.result || res;
    if (!result.access_token) throw new Error("no access_token in response");

    localStorage.setItem(LS_ACCESS_TOKEN, result.access_token);
    if (result.refresh_token) localStorage.setItem(LS_REFRESH_TOKEN, result.refresh_token);
    const expiresAt = Date.now() + (result.expires_in ?? 14400) * 1000;
    localStorage.setItem(LS_TOKEN_EXPIRES, String(expiresAt));
    localStorage.removeItem(LS_CODE_VERIFIER);

    // 新しくログインし直したので、seed 済み client と namespace キャッシュをリセット
    _seededAuth = null;
    _rootNamespace = localStorage.getItem(LS_ROOT_NS);
    _rootNsResolved = false;
    resetSessionExpiredFlag();

    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
    return true;
  } catch (err) {
    console.error("[dbx-auth] token exchange failed:", err);
    return false;
  }
}

// ─── トークンを seed した persistent DropboxAuth（自動更新の心臓部） ───
let _seededAuth: DropboxAuth | null = null;

function getSeededAuth(): DropboxAuth | null {
  const access = localStorage.getItem(LS_ACCESS_TOKEN);
  const refresh = localStorage.getItem(LS_REFRESH_TOKEN);
  const expires = parseInt(localStorage.getItem(LS_TOKEN_EXPIRES) || "0", 10);
  if (!access && !refresh) return null;

  if (!_seededAuth) {
    _seededAuth = new DropboxAuth({
      clientId: APP_KEY,
      fetch: window.fetch.bind(window),
      accessToken: access || undefined,
      refreshToken: refresh || undefined,
      accessTokenExpiresAt: expires ? new Date(expires) : undefined,
    });
  } else {
    // 別タブが localStorage を更新している可能性に追従
    if (access) _seededAuth.setAccessToken(access);
    if (refresh) _seededAuth.setRefreshToken(refresh);
    if (expires) _seededAuth.setAccessTokenExpiresAt(new Date(expires));
  }
  return _seededAuth;
}

// SDK が refresh した新トークンを localStorage に書き戻す（次回起動・別タブ用）。
function persistAuthTokens(auth: DropboxAuth): void {
  try {
    const token = auth.getAccessToken();
    const exp = auth.getAccessTokenExpiresAt();
    if (token) localStorage.setItem(LS_ACCESS_TOKEN, token);
    if (exp) localStorage.setItem(LS_TOKEN_EXPIRES, String(exp.getTime()));
  } catch {
    // ignore
  }
}

// ─── 認証エラー判定 ───
/** SDK が投げたエラーが「認証エラー（401）」かどうか。 */
export function isDropboxAuthError(err: any): boolean {
  if (!err) return false;
  if (err.status === 401) return true;
  const blob = JSON.stringify(err?.error || err?.message || "").toLowerCase();
  return (
    blob.includes("expired_access_token") ||
    blob.includes("invalid_access_token") ||
    blob.includes("invalid_grant")
  );
}

/** refresh_token 自体が死んでいる（再ログイン必須）かどうか。 */
export function isRefreshDead(err: any): boolean {
  if (!err) return false;
  const blob = JSON.stringify(err?.error || err?.message || "").toLowerCase();
  // refresh エンドポイントは死亡時 400 invalid_grant を返す
  if (err.status === 400 && blob.includes("invalid_grant")) return true;
  if (blob.includes("invalid_grant")) return true;
  return false;
}

// ─── セッション期限切れ通知（多重発火防止） ───
let sessionExpiredNotified = false;
export function notifySessionExpired(): void {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  console.warn("[dbx-auth] session expired → dispatching", DBX_SESSION_EXPIRED_EVENT);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DBX_SESSION_EXPIRED_EVENT));
  }
}
export function resetSessionExpiredFlag(): void {
  sessionExpiredNotified = false;
}

/**
 * catch 節で呼ぶ共通ハンドラ。認証エラーなら：
 *   - refresh が死んでいれば notifySessionExpired()
 *   - そうでなければ（一時的 401）も念のため通知（SDK 自動 refresh が効かなかったケース）
 * 認証エラーでなければ何もしない。
 * @returns 認証エラーだったら true
 */
export function handleDbxError(err: any): boolean {
  if (isDropboxAuthError(err) || isRefreshDead(err)) {
    notifySessionExpired();
    return true;
  }
  return false;
}

// ─── チーム root namespace 解決（チームフォルダ access 用） ───
let _rootNamespace: string | null =
  typeof localStorage !== "undefined" ? localStorage.getItem(LS_ROOT_NS) : null;
let _rootNsResolved = false;

async function resolveRootNamespace(dbx: Dropbox): Promise<string | null> {
  if (_rootNamespace) return _rootNamespace;
  if (_rootNsResolved) return null;
  try {
    const acc: any = await dbx.usersGetCurrentAccount();
    const rootNs =
      acc?.result?.root_info?.root_namespace_id || acc?.root_info?.root_namespace_id;
    if (rootNs) {
      _rootNamespace = rootNs;
      localStorage.setItem(LS_ROOT_NS, rootNs);
      console.log("[dbx-auth] root namespace resolved:", rootNs);
    }
    _rootNsResolved = true;
    return _rootNamespace;
  } catch (err) {
    console.warn("[dbx-auth] root namespace resolve failed:", err);
    _rootNsResolved = true;
    return null;
  }
}

function buildDropbox(auth: DropboxAuth): Dropbox {
  return new Dropbox({
    auth,
    fetch: window.fetch.bind(window),
    pathRoot: _rootNamespace
      ? JSON.stringify({ ".tag": "root", root: _rootNamespace })
      : undefined,
  });
}

/**
 * Dropbox SDK インスタンスを返す（access_token 自動更新つき）。
 *   1. seed 済み DropboxAuth で checkAndRefreshAccessToken（5 分バッファで自動更新）
 *   2. 更新後トークンを localStorage に永続化
 *   3. refresh 死亡時は notifySessionExpired() して null
 *   4. team root namespace を pathRoot に設定（チームフォルダ access 用）
 */
export async function getDropboxClient(): Promise<Dropbox | null> {
  const auth = getSeededAuth();
  if (!auth) return null;

  try {
    // SDK 内蔵の自動更新。期限が 5 分以内なら refresh_token で更新する。
    await auth.checkAndRefreshAccessToken();
    persistAuthTokens(auth);
  } catch (err) {
    // 更新自体が失敗 → refresh_token が死んでいる可能性が高い
    if (handleDbxError(err)) return null;
    // ネットワークエラー等は、手持ちトークンで続行を試みる
  }

  // 初回だけ root namespace を解決（pathRoot 未設定なら）
  if (!_rootNamespace && !_rootNsResolved) {
    const probe = new Dropbox({ auth, fetch: window.fetch.bind(window) });
    await resolveRootNamespace(probe);
  }

  return buildDropbox(auth);
}

/** ログアウト：全 token + namespace キャッシュを破棄。 */
export function signOut(): void {
  localStorage.removeItem(LS_ACCESS_TOKEN);
  localStorage.removeItem(LS_REFRESH_TOKEN);
  localStorage.removeItem(LS_TOKEN_EXPIRES);
  localStorage.removeItem(LS_CODE_VERIFIER);
  localStorage.removeItem(LS_ROOT_NS);
  _seededAuth = null;
  _rootNamespace = null;
  _rootNsResolved = false;
}

export function isDropboxLoggedIn(): boolean {
  return (
    !!localStorage.getItem(LS_ACCESS_TOKEN) || !!localStorage.getItem(LS_REFRESH_TOKEN)
  );
}

/**
 * 後方互換のために残す（旧コードが import している）。
 * 自動更新は getDropboxClient 側で行うので、ここでは現在の有効トークンを返すだけ。
 */
export async function getValidAccessToken(): Promise<string | null> {
  const auth = getSeededAuth();
  if (!auth) return null;
  try {
    await auth.checkAndRefreshAccessToken();
    persistAuthTokens(auth);
    return auth.getAccessToken() || null;
  } catch (err) {
    handleDbxError(err);
    return null;
  }
}
