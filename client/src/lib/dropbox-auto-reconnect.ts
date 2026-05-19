// Dropbox API 呼び出しを包み、認証エラー時にポップアップで再認証を自動起動するヘルパー。
//
// 使い方:
//   const res = await fetchDropbox("/api/dropbox/browse?path=/foo");
//   // 401 や「Dropbox not connected」系エラーが返ったら、自動で OAuth ポップアップを開き
//   // 認可完了後に元のリクエストを1度リトライして、その Response を返す。
//   // ポップアップがブロック/ユーザーキャンセルの場合は元のエラー Response をそのまま返す。
//
// デザイン方針:
//   - 同時多発的な失敗で何度もポップアップが開かないように、単一の Promise で dedupe
//   - 一度自動再接続して更に失敗した場合はループさせず、エラーをそのまま返す
//   - バックグラウンド status ポーリングなど「静かに扱いたい」呼び出し側では allowReconnect:false を指定

let activeReconnectPromise: Promise<void> | null = null;

/**
 * Dropbox の OAuth 再接続ポップアップを開き、認可完了 or キャンセルされるまで待つ。
 * 複数同時に呼ばれた場合も 1 つのポップアップにまとめる(dedupe)。
 */
export async function triggerDropboxReconnect(): Promise<void> {
  if (activeReconnectPromise) return activeReconnectPromise;

  activeReconnectPromise = new Promise<void>((resolve) => {
    const popup = window.open(
      "/api/dropbox/oauth/start",
      "dropbox-auth",
      "width=600,height=700"
    );

    if (!popup) {
      // ポップアップブロックされた場合は同タブ遷移にフォールバック
      // 遷移が走るので resolve は呼ばれないが、万一遷移が CSP 等で失敗したケースに
      // 備えて activeReconnectPromise を null に戻しておく（次回の dedupe が固まらないため）
      activeReconnectPromise = null;
      window.location.href = "/api/dropbox/oauth/start";
      return;
    }

    const onMessage = (e: MessageEvent) => {
      if (e.data === "dropbox-connected") {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(pollClosed);
      activeReconnectPromise = null;
    };

    window.addEventListener("message", onMessage);

    // ポップアップが閉じられたら、接続完了メッセージ未受信でも終了扱い
    const pollClosed = setInterval(() => {
      if (popup.closed) {
        cleanup();
        resolve();
      }
    }, 500);
  });

  return activeReconnectPromise;
}

/** レスポンスが「Dropbox 認証エラー」かどうかを判定 */
export function isDropboxAuthError(bodyText: string, status: number): boolean {
  if (status === 401) return true;
  const lowered = (bodyText || "").toLowerCase();
  return (
    lowered.includes("dropbox not connected") ||
    lowered.includes("no refresh token") ||
    lowered.includes("dropbox is not configured") ||
    lowered.includes("invalid_access_token") ||
    lowered.includes("expired_access_token") ||
    lowered.includes("invalid_grant") ||
    lowered.includes("please reconnect")
  );
}

interface FetchDropboxOptions {
  /** false にすると自動再接続を走らせず、素のレスポンスをそのまま返す(バックグラウンド用) */
  allowReconnect?: boolean;
  /** 1 リクエストあたりのタイムアウト（ms）。デフォルト 30 秒。
   *  これを入れないと、サーバ応答が来ないときに UI のローディングが永遠に止まる。 */
  timeoutMs?: number;
}

/**
 * AbortController でラップした fetch。タイムアウトすると AbortError を throw する。
 * 上位の呼び出し側が `signal` を渡していれば、そちらも尊重する（user の手動キャンセル）。
 */
async function fetchWithTimeout(input: RequestInfo, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const userSignal = init?.signal;
  const onUserAbort = () => ac.abort();
  if (userSignal) {
    if (userSignal.aborted) ac.abort();
    else userSignal.addEventListener("abort", onUserAbort);
  }
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(input, { ...(init || {}), signal: ac.signal });
  } finally {
    clearTimeout(timer);
    if (userSignal) userSignal.removeEventListener("abort", onUserAbort);
  }
}

/**
 * Dropbox 関連 API 呼び出し用の fetch ラッパー。
 * 認証エラーを検知したら自動で OAuth 再接続ポップアップを開き、認可完了後に1度だけリトライする。
 * 30 秒（デフォルト）でタイムアウト：UI ローディングが固まる事故の防止。
 */
export async function fetchDropbox(
  input: RequestInfo,
  init?: RequestInit,
  opts: FetchDropboxOptions = {}
): Promise<Response> {
  const { allowReconnect = true, timeoutMs = 30000 } = opts;

  let res: Response;
  try {
    res = await fetchWithTimeout(input, init, timeoutMs);
  } catch (err: any) {
    // タイムアウト or ネットワークエラー：上位に伝播させて UI を「失敗」状態へ遷移させる。
    // ここで握りつぶすと UI が固まったままになるので絶対に NG。
    throw err;
  }
  if (res.ok || !allowReconnect) return res;

  // レスポンスボディをクローンして内容確認(呼び出し側でも読めるように)
  let bodyText = "";
  try {
    bodyText = await res.clone().text();
  } catch {
    // ignore
  }

  if (!isDropboxAuthError(bodyText, res.status)) return res;

  // 認証エラーと判定 → 自動再接続を試みる
  try {
    await triggerDropboxReconnect();
  } catch {
    return res;
  }

  // 再接続後に1度だけリトライ。さらに失敗したらそのまま返す(無限ループ防止)
  try {
    return await fetchWithTimeout(input, init, timeoutMs);
  } catch {
    return res;
  }
}
