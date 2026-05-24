// サーバが居ない環境（GitHub Pages 等）で /api/dropbox/download 系の fetch を
// 透過的に Dropbox JS SDK 経由に振り替える。
//
// クライアントコードの呼び出し側（project.tsx, prefetchAudio.ts, audioBulkRelink.ts 等）は
// `fetch("/api/dropbox/download?path=...")` のまま。
// この installer が一度だけ window.fetch を上書きして、サーバ無い場合に Dropbox SDK で代替する。
//
// サーバが居る環境では従来通り素通し。後方互換 100%。
//
// 制約：
//   - convert=mp3 クエリは無視（クライアントで再エンコードしない）。Dropbox 上に既にある形式で返す。
//     ほとんどの曲は mp3 / wav / m4a / flac で、Chrome/Safari は MSE で大半再生可。
//   - 認証切れの場合は元の fetch にフォールスルー（401/404 が返って既存エラーハンドリングが動く）。

import { getDropboxClient } from "./dropboxAuth";

let installed = false;

export function installDropboxFetchShim(): void {
  if (installed) return;
  installed = true;

  const origFetch = window.fetch.bind(window);

  // サーバ側 /api/dropbox/download の代理レスポンスを Dropbox SDK で生成する。
  async function tryDropboxDirect(url: string): Promise<Response | null> {
    try {
      const u = new URL(url, window.location.origin);
      const path = u.searchParams.get("path");
      if (!path) return null;

      const dbx = await getDropboxClient();
      if (!dbx) return null; // 未ログインなら fallthrough

      // filesDownload は Blob を返してくれるブラウザ実装
      const res: any = await dbx.filesDownload({ path });
      const blob: Blob = res.result?.fileBlob ?? res.fileBlob;
      if (!blob) return null;

      // 元のサーバが返していた Content-Type を可能な範囲で再現
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
      console.warn("[dbx-fetch] direct download failed:", err);
      return null;
    }
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    // /api/dropbox/download だけを対象にする。他の /api は素通し。
    if (url.includes("/api/dropbox/download")) {
      // まず本物のサーバを試す。成功すればそれを返す（dev mode で動く）。
      try {
        const res = await origFetch(input, init);
        if (res.ok) return res;
        if (res.status === 404 || res.status === 502 || res.status === 503) {
          const direct = await tryDropboxDirect(url);
          if (direct) return direct;
        }
        return res;
      } catch (err) {
        // ネットワーク完全断 or サーバ自体が居ない → Dropbox 直
        const direct = await tryDropboxDirect(url);
        if (direct) return direct;
        throw err;
      }
    }

    return origFetch(input, init);
  };

  console.log("[dbx-fetch] fetch shim installed (Dropbox direct fallback for /api/dropbox/download)");
}
