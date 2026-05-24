// IndexedDB と localStorage の全データを JSON でエクスポート/インポートする。
//
// 用途：
//   - 別 origin への移行（telop-studio-production.up.railway.app → localhost）
//   - 重大事故時の復旧
//   - serverless 化の Dropbox JSON sync の prototype 検証
//
// 注意：blob（音源データ）は含めない（容量が GB 単位になるため）。
// 音源は dropboxPath 経由で再 download する設計。

import { getDB } from "./db";

export interface BackupData {
  _version: number;
  _timestamp: string;
  projects?: any[];
  lyrics?: any[];
  audioTracks?: any[]; // blob 抜き
  checkMarkers?: any[];
  deletedProjects?: any[];
  _localStorage?: Record<string, string>;
}

const LS_KEYS_TO_BACKUP = [
  "telop-folders",
  "telop-pinned",
  "telop-tags",
  "telop-recent-projects",
  "telop-snapshots-v1",
  "telop-sort-mode",
  "telop-live-mode",
];

export async function exportBackup(): Promise<BackupData> {
  // 既存の getDB を使うと既存 connection を共有できる
  const db = await getDB();
  const data: BackupData = { _version: 1, _timestamp: new Date().toISOString() };

  for (const storeName of ["projects", "lyrics", "audioTracks", "checkMarkers", "deletedProjects"] as const) {
    if (!db.objectStoreNames.contains(storeName)) continue;
    const all = await db.getAll(storeName as any);
    // blob は除外（音源データは Dropbox から再取得）
    (data as any)[storeName] = (all as any[]).map((item: any) => {
      const copy = { ...item };
      if ("blob" in copy) delete copy.blob;
      return copy;
    });
  }

  data._localStorage = {};
  for (const k of LS_KEYS_TO_BACKUP) {
    const v = localStorage.getItem(k);
    if (v) data._localStorage[k] = v;
  }

  return data;
}

export function downloadBackup(data: BackupData, filenamePrefix = "telop-studio-backup"): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ImportResult {
  projects: number;
  lyrics: number;
  audioTracks: number;
  markers: number;
  deleted: number;
  localStorage: number;
}

/**
 * バックアップを IndexedDB と localStorage に書き込む。
 * 既存データはマージされる（同一 id は上書き）。
 * audioTracks の blob は backup に含まれないので、新規空 ArrayBuffer で作成。
 * これにより既存曲の blob は壊さない（既存 blob は上書きされない）。
 */
export async function importBackup(data: BackupData): Promise<ImportResult> {
  if (!data || typeof data !== "object" || data._version !== 1) {
    throw new Error("Invalid backup format (expected _version: 1)");
  }

  const db = await getDB();
  const result: ImportResult = { projects: 0, lyrics: 0, audioTracks: 0, markers: 0, deleted: 0, localStorage: 0 };

  if (Array.isArray(data.projects)) {
    const tx = db.transaction("projects", "readwrite");
    for (const p of data.projects) {
      await tx.store.put(p);
      result.projects++;
    }
    await tx.done;
  }

  if (Array.isArray(data.lyrics)) {
    const tx = db.transaction("lyrics", "readwrite");
    for (const l of data.lyrics) {
      await tx.store.put(l);
      result.lyrics++;
    }
    await tx.done;
  }

  if (Array.isArray(data.audioTracks)) {
    const tx = db.transaction("audioTracks", "readwrite");
    for (const t of data.audioTracks) {
      // 既存レコードがあれば blob は維持、なければ新規作成（blob 空）
      const existing = await tx.store.get(t.id);
      const next = {
        ...t,
        blob: existing && existing.blob && (existing.blob as ArrayBuffer).byteLength > 0
          ? existing.blob
          : new ArrayBuffer(0),
      };
      await tx.store.put(next);
      result.audioTracks++;
    }
    await tx.done;
  }

  if (Array.isArray(data.checkMarkers)) {
    const tx = db.transaction("checkMarkers", "readwrite");
    for (const m of data.checkMarkers) {
      await tx.store.put(m);
      result.markers++;
    }
    await tx.done;
  }

  if (Array.isArray(data.deletedProjects)) {
    const tx = db.transaction("deletedProjects", "readwrite");
    for (const d of data.deletedProjects) {
      await tx.store.put(d);
      result.deleted++;
    }
    await tx.done;
  }

  if (data._localStorage && typeof data._localStorage === "object") {
    for (const [k, v] of Object.entries(data._localStorage)) {
      if (typeof v === "string" && LS_KEYS_TO_BACKUP.includes(k)) {
        try {
          localStorage.setItem(k, v);
          result.localStorage++;
        } catch {
          // quota over など。silent skip。
        }
      }
    }
  }

  return result;
}
