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
      window.location.href = "/api/dropbox/oauth/start";
      // 遷移するので resolve は呼ばれない
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
}

/**
 * Dropbox 関連 API 呼び出し用の fetch ラッパー。
 * 認証エラーを検知したら自動で OAuth 再接続ポップアップを開き、認可完了後に1度だけリトライする。
 */
export async function fetchDropbox(
  input: RequestInfo,
  init?: RequestInit,
  opts: FetchDropboxOptions = {}
): Promise<Response> {
  const { allowReconnect = true } = opts;

  const res = await fetch(input, init);
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
    return await fetch(input, init);
  } catch {
    return res;
  }
}
