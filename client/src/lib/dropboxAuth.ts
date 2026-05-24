// Dropbox OAuth (PKCE flow) — クライアントだけで完結。
//
// 従来のフロー：クライアント → サーバ /api/dropbox/oauth/start → Dropbox 認証 →
//              サーバ /api/dropbox/oauth/callback → セッション保存
// 新フロー（PKCE）：
//              クライアント → Dropbox 認証 → クライアント /auth-callback →
//              code + verifier で /oauth2/token → access_token/refresh_token を
//              localStorage 保存
//
// サーバ完全不要。GitHub Pages にデプロイしても OAuth が成立する。
//
// 設定要件（Dropbox Developer Console "TELOP STUDIO 2026" app）：
//   - Allow public clients (Implicit Grant & PKCE): Allow（既に ON）
//   - Redirect URIs に以下を追加：
//       https://nrs2013.github.io/telop-studio/  （本番、GitHub Pages）
//       http://localhost:5001/                    （dev サーバ）
//       http://localhost:5173/                    （Vite dev サーバ）

import { Dropbox, DropboxAuth } from "dropbox";

const APP_KEY = "ntg90kn8q9us8h6"; // TELOP STUDIO 2026 app key（公開可能、secret はクライアントに持たない）

const LS_ACCESS_TOKEN = "telop-dbx-access-token";
const LS_REFRESH_TOKEN = "telop-dbx-refresh-token";
const LS_TOKEN_EXPIRES = "telop-dbx-token-expires";
const LS_CODE_VERIFIER = "telop-dbx-pkce-verifier";

// dev / prod 両対応：現在の origin を redirect URI として使う
function getRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin + window.location.pathname;
}

let _authClient: DropboxAuth | null = null;
function getAuthClient(): DropboxAuth {
  if (_authClient) return _authClient;
  _authClient = new DropboxAuth({
    clientId: APP_KEY,
    fetch: window.fetch.bind(window),
  });
  return _authClient;
}

/**
 * 「Dropbox にログイン」ボタンから呼ぶ。
 * PKCE 用の code_verifier を生成して localStorage に保存し、認証 URL に飛ばす。
 */
export async function startDropboxOAuth(): Promise<void> {
  const auth = getAuthClient();
  // SDK が code_verifier を自動生成してくれる。それを保存して、後で getAccessTokenFromCode で使う。
  const redirectUri = getRedirectUri();
  const authUrl: any = await auth.getAuthenticationUrl(
    redirectUri,
    undefined,
    "code",
    "offline",  // refresh_token を要求
    undefined,
    "none",
    true        // usePKCE
  );
  // SDK 内部で code_verifier がセットされる。それを取り出して保存。
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

  const auth = getAuthClient();
  (auth as any).codeVerifier = verifier;
  auth.setCodeVerifier?.(verifier);

  try {
    const redirectUri = getRedirectUri().split("?")[0]; // URL から code を取り除いて redirect_uri 一致させる
    const res: any = await auth.getAccessTokenFromCode(redirectUri, code);
    const result = res.result || res;
    if (!result.access_token) throw new Error("no access_token in response");

    localStorage.setItem(LS_ACCESS_TOKEN, result.access_token);
    if (result.refresh_token) localStorage.setItem(LS_REFRESH_TOKEN, result.refresh_token);
    const expiresAt = Date.now() + (result.expires_in ?? 14400) * 1000 - 60_000;
    localStorage.setItem(LS_TOKEN_EXPIRES, String(expiresAt));
    localStorage.removeItem(LS_CODE_VERIFIER);

    // 認証成功後、URL から code を取り除いてホームへ
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
    return true;
  } catch (err) {
    console.error("[dbx-auth] token exchange failed:", err);
    return false;
  }
}

/**
 * 現在の access_token を返す。期限切れなら refresh_token で更新を試みる。
 * 取れなければ null（再ログインが必要）。
 */
export async function getValidAccessToken(): Promise<string | null> {
  const access = localStorage.getItem(LS_ACCESS_TOKEN);
  const expires = parseInt(localStorage.getItem(LS_TOKEN_EXPIRES) || "0", 10);
  if (access && expires > Date.now()) return access;

  // refresh を試みる
  const refresh = localStorage.getItem(LS_REFRESH_TOKEN);
  if (!refresh) return null;
  try {
    const res = await fetch("https://api.dropbox.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: APP_KEY,
      }),
    });
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
    const data = await res.json();
    if (!data.access_token) throw new Error("no access_token in refresh response");
    localStorage.setItem(LS_ACCESS_TOKEN, data.access_token);
    const newExpires = Date.now() + (data.expires_in ?? 14400) * 1000 - 60_000;
    localStorage.setItem(LS_TOKEN_EXPIRES, String(newExpires));
    return data.access_token;
  } catch (err) {
    console.warn("[dbx-auth] refresh failed:", err);
    return null;
  }
}

/** Dropbox SDK インスタンスを返す（access_token 自動付与）。 */
export async function getDropboxClient(): Promise<Dropbox | null> {
  const token = await getValidAccessToken();
  if (!token) return null;
  return new Dropbox({ accessToken: token, fetch: window.fetch.bind(window) });
}

/** ログアウト：全 token を破棄。 */
export function signOut(): void {
  localStorage.removeItem(LS_ACCESS_TOKEN);
  localStorage.removeItem(LS_REFRESH_TOKEN);
  localStorage.removeItem(LS_TOKEN_EXPIRES);
  localStorage.removeItem(LS_CODE_VERIFIER);
}

export function isDropboxLoggedIn(): boolean {
  return !!localStorage.getItem(LS_ACCESS_TOKEN) || !!localStorage.getItem(LS_REFRESH_TOKEN);
}
