// 音源の事前ダウンロード（prefetch）バックグラウンドジョブ。
//
// 目的：本番現場で「曲をクリック → 開くまで待たされる／Dropbox 全体検索」を回避するため、
// よく使う曲（ピン留め + 最近開いた N 件）の音源を起動後に裏で先取り download する。
//
// 設計方針：
//   - 順次実行（並列だと Dropbox API レート制限に引っかかる）
//   - 失敗は silent skip（本番進行を絶対に妨げない）
//   - 既に blob があるトラックはスキップ
//   - localOnlyMode (本番モード) が ON のときは prefetch しない（サーバ通信を止める方針に従う）
//   - 起動から数秒の遅延を入れて、UI 初期描画と autoSync を邪魔しない

import { storage } from "./storage";
import { syncService } from "./syncService";
import { fetchDropbox } from "./dropbox-auto-reconnect";
import { loadPinnedProjectIds, getRecentProjectIds } from "./recentProjects";

interface PrefetchOptions {
  /** 起動からこの秒数だけ待ってから開始 */
  startDelayMs?: number;
  /** 各 download の間にこの ms 待つ（Dropbox レート制限対策） */
  perTrackDelayMs?: number;
}

let prefetchRunning = false;

/**
 * ピン留め + 最近開いた N 件のプロジェクトの音源を順次 prefetch する。
 * 起動時に 1 回呼べば十分。多重呼び出しは内部 flag で防ぐ。
 */
export function schedulePrefetchAudios(options: PrefetchOptions = {}): void {
  if (prefetchRunning) return;
  const startDelayMs = options.startDelayMs ?? 8000;
  const perTrackDelayMs = options.perTrackDelayMs ?? 1500;

  prefetchRunning = true;
  setTimeout(() => {
    runPrefetch(perTrackDelayMs)
      .catch((err) => console.debug("[prefetch] aborted with error:", err))
      .finally(() => { prefetchRunning = false; });
  }, startDelayMs);
}

async function runPrefetch(perTrackDelayMs: number): Promise<void> {
  // 本番モード中は何もしない（演出家が「サーバ通信を止めたい」と明示している状態）
  if (syncService.isLocalOnlyMode()) {
    console.log("[prefetch] skipped: local-only (LIVE) mode is ON");
    return;
  }

  const pinned = loadPinnedProjectIds();
  const recents = getRecentProjectIds();

  // 優先順位：ピン留め → 最近開いた（新しい順）
  // 重複は除去（pinned が先頭で、recents の同じ id はスキップ）
  const targetProjectIds: string[] = [];
  const seen = new Set<string>();
  for (const id of pinned) {
    if (!seen.has(id)) { targetProjectIds.push(id); seen.add(id); }
  }
  for (const id of recents) {
    if (!seen.has(id)) { targetProjectIds.push(id); seen.add(id); }
  }

  if (targetProjectIds.length === 0) {
    console.log("[prefetch] no candidate projects (pin or recent)");
    return;
  }

  console.log(`[prefetch] queued ${targetProjectIds.length} project(s):`, targetProjectIds);

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const projectId of targetProjectIds) {
    // 本番モードに切り替わったら即停止
    if (syncService.isLocalOnlyMode()) {
      console.log("[prefetch] interrupted: LIVE mode turned ON mid-run");
      break;
    }
    try {
      const tracks = await storage.getAudioTracks(projectId);
      for (const track of tracks) {
        if (syncService.isLocalOnlyMode()) break;
        if (!track.dropboxPath) { skipped++; continue; }
        // 既に blob があるなら不要
        const existing = await storage.getAudioTrack(track.id);
        if (existing && existing.arrayBuffer.byteLength > 0) { skipped++; continue; }

        const ok = await tryPrefetchOne(track.id, track.dropboxPath);
        if (ok) succeeded++; else failed++;

        // レート制限と CPU/ネットワーク負荷の双方を考慮した間隔
        await delay(perTrackDelayMs);
      }
    } catch (err) {
      console.debug(`[prefetch] project ${projectId} failed:`, err);
      failed++;
    }
  }

  console.log(`[prefetch] done: succeeded=${succeeded}, skipped=${skipped}, failed=${failed}`);
}

async function tryPrefetchOne(trackId: string, dropboxPath: string): Promise<boolean> {
  try {
    const pathExt = dropboxPath.split(".").pop()?.toLowerCase() || "";
    const needsConvert = pathExt !== "mp3" && ["wav", "m4a", "aac", "ogg", "flac", "wma", "aiff"].includes(pathExt);
    const url = needsConvert
      ? `/api/dropbox/download?path=${encodeURIComponent(dropboxPath)}&convert=mp3`
      : `/api/dropbox/download?path=${encodeURIComponent(dropboxPath)}`;
    // allowReconnect:false にして、prefetch のために OAuth ポップアップを開かないようにする。
    // 認証切れなら静かに失敗し、ユーザーが実際にその曲を開いたタイミングで通常の再接続フローに任せる。
    const res = await fetchDropbox(url, undefined, { allowReconnect: false });
    if (!res.ok) {
      console.debug(`[prefetch] miss: ${dropboxPath} status=${res.status}`);
      return false;
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength === 0) return false;
    await storage.updateAudioTrackBlob(trackId, ab);
    console.log(`[prefetch] cached: ${dropboxPath} (${ab.byteLength} bytes)`);
    return true;
  } catch (err) {
    console.debug(`[prefetch] error on ${dropboxPath}:`, err);
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
