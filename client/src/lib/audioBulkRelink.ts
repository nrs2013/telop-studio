// 全曲一括リンク復元ジョブ。
//
// 目的：path 切れの曲（dropboxPath が壊れている or 空、blob も空）を、
// バックグラウンドで「exact name match → 自動リンク」まで自動修復する。
//
// 安全規律（過去事故から学んだもの）：
//   - exact match（サーバが found=true で返したもの）だけ自動リンクする。
//     fuzzy 候補（suggestions のみ）は絶対に自動リンクしない（誤マッチ事故防止）。
//   - 同名複数（ambiguous）も自動リンク不可。
//   - download 成功してから dropboxPath を書き換える（blob なしの path 単体は禁止）。
//   - 各リンク後に syncService.markTrackTouched() で 60 秒の race protection。
//   - 各 step に間隔を入れて Dropbox API のレート制限を回避。
//   - 本番モード（LIVE）中は実行しない。実行中に ON になったら即停止。

import { storage } from "./storage";
import { syncService } from "./syncService";
import { fetchDropbox } from "./dropbox-auto-reconnect";

export interface BulkRelinkProgress {
  total: number;
  done: number;
  alreadyOk: number;       // blob 既存 or path で download 成功
  autoRelinked: number;    // exact match で自動リンク成功
  needsManual: number;     // fuzzy / ambiguous 候補ありで手動選択必要
  noMatch: number;         // Dropbox に何も無い
  error: number;           // 例外発生
  currentName: string | null;
}

export interface BulkRelinkResult {
  total: number;
  alreadyOk: number;
  autoRelinked: number;
  needsManual: number;
  noMatch: number;
  error: number;
  cancelled: boolean;
}

interface BulkRelinkOptions {
  onProgress?: (p: BulkRelinkProgress) => void;
  /** 各 track 処理の間にこの ms 待つ（Dropbox レート制限対策） */
  perTrackDelayMs?: number;
  /** AbortSignal でキャンセル可能 */
  signal?: AbortSignal;
}

let running = false;

function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  return /^imported_audio(\.\w+)?$/i.test(name.trim());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryDownload(downloadPath: string, signal?: AbortSignal): Promise<{ data: ArrayBuffer | null; status: number }> {
  try {
    const ext = downloadPath.split(".").pop()?.toLowerCase() || "";
    const needsConvert = ext !== "mp3" && ["wav", "m4a", "aac", "ogg", "flac", "wma", "aiff"].includes(ext);
    const url = needsConvert
      ? `/api/dropbox/download?path=${encodeURIComponent(downloadPath)}&convert=mp3`
      : `/api/dropbox/download?path=${encodeURIComponent(downloadPath)}`;
    // 一括バックグラウンドジョブでは OAuth ポップアップを開かない
    const res = await fetchDropbox(url, { signal }, { allowReconnect: false, timeoutMs: 45000 });
    if (!res.ok) return { data: null, status: res.status };
    const ab = await res.arrayBuffer();
    return { data: ab, status: res.status };
  } catch {
    return { data: null, status: 0 };
  }
}

export async function runBulkRelink(options: BulkRelinkOptions = {}): Promise<BulkRelinkResult> {
  if (running) {
    throw new Error("Bulk relink is already running");
  }
  running = true;

  const perTrackDelayMs = options.perTrackDelayMs ?? 1200;
  const signal = options.signal;
  const onProgress = options.onProgress;

  const projects = await storage.getProjects();
  // メタだけリスト化。blob 存在チェックはループ内で getAudioTrack 経由で（メモリ節約）。
  const allTracks: { projectId: string; trackId: string; fileName: string; dropboxPath?: string }[] = [];
  for (const p of projects) {
    const tracks = await storage.getAudioTracks(p.id);
    for (const t of tracks) {
      allTracks.push({ projectId: p.id, trackId: t.id, fileName: t.fileName, dropboxPath: t.dropboxPath });
    }
  }

  const progress: BulkRelinkProgress = {
    total: allTracks.length,
    done: 0,
    alreadyOk: 0,
    autoRelinked: 0,
    needsManual: 0,
    noMatch: 0,
    error: 0,
    currentName: null,
  };
  onProgress?.({ ...progress });

  let cancelled = false;

  for (const { projectId, trackId, fileName, dropboxPath } of allTracks) {
    if (signal?.aborted) { cancelled = true; break; }
    // LIVE モードに切り替わったら即停止
    if (syncService.isLocalOnlyMode()) {
      console.log("[bulk-relink] aborted: LIVE mode ON");
      cancelled = true;
      break;
    }

    progress.currentName = fileName;
    onProgress?.({ ...progress });
    let counted = false;

    try {
      // Step 1: 既に blob あれば skip（このときだけ getAudioTrack で実 blob 取得）
      const existing = await storage.getAudioTrack(trackId);
      if (existing && existing.arrayBuffer.byteLength > 0) {
        progress.alreadyOk++;
        counted = true;
        continue;
      }

      // Step 2: dropboxPath で download 試行
      if (dropboxPath) {
        const res = await tryDownload(dropboxPath, signal);
        if (res.data && res.data.byteLength > 0) {
          await storage.updateAudioTrackBlob(trackId, res.data);
          syncService.markTrackTouched(trackId);
          progress.alreadyOk++;
          counted = true;
          continue;
        }
      }

      // Step 3: 名前で exact match を試す（fuzzy 候補は自動リンクしない）
      // imported_audio などのプレースホルダ名は検索しても意味がないので skip
      if (isPlaceholderName(fileName)) {
        progress.needsManual++;
        counted = true;
        continue;
      }

      const searchName = fileName.replace(/\.(mp3|wav|m4a|aac|ogg|flac|wma|aiff|aif|opus)$/i, "");
      const findUrl = `/api/dropbox/find?fileName=${encodeURIComponent(searchName)}`;
      const findRes = await fetchDropbox(findUrl, { signal }, { allowReconnect: false, timeoutMs: 30000 });
      if (!findRes.ok) {
        progress.error++;
        counted = true;
        continue;
      }
      const findData = await findRes.json();

      // 完全一致（サーバ側で unique 判定済）のみ自動リンク
      if (findData.found && findData.path) {
        const dl = await tryDownload(findData.path, signal);
        if (dl.data && dl.data.byteLength > 0) {
          await storage.updateAudioTrackBlob(trackId, dl.data);
          await storage.updateAudioTrackDropboxPath(trackId, findData.path);
          syncService.markTrackTouched(trackId);
          // サーバへ push（dirty フラグ立てて、後でまとめて schedulePush）
          syncService.markDirty(projectId);
          progress.autoRelinked++;
        } else {
          progress.error++;
        }
      } else if (findData.ambiguous || (Array.isArray(findData.suggestions) && findData.suggestions.length > 0)) {
        // 候補ありだが ambiguous or fuzzy → 自動リンクしない（手動 Dialog 待ち）
        progress.needsManual++;
      } else {
        // Dropbox 上に該当無し
        progress.noMatch++;
      }
      counted = true;
    } catch (err) {
      console.warn(`[bulk-relink] error on ${fileName}:`, err);
      progress.error++;
      counted = true;
    } finally {
      if (counted) progress.done++;
      progress.currentName = null;
      onProgress?.({ ...progress });
    }

    await delay(perTrackDelayMs);
  }

  // 修復した曲をまとめてサーバ push
  // markDirty しただけだと autoSync 待ちなので、各 dirty project に schedulePush でキック
  try {
    const dirtyProjectIds = new Set<string>();
    for (const { projectId } of allTracks) {
      if (syncService.isDirty(projectId)) dirtyProjectIds.add(projectId);
    }
    for (const pid of dirtyProjectIds) {
      syncService.schedulePush(pid);
    }
  } catch {}

  running = false;
  return {
    total: progress.total,
    alreadyOk: progress.alreadyOk,
    autoRelinked: progress.autoRelinked,
    needsManual: progress.needsManual,
    noMatch: progress.noMatch,
    error: progress.error,
    cancelled,
  };
}

export function isBulkRelinkRunning(): boolean {
  return running;
}
