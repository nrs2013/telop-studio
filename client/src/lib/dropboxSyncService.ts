// Dropbox 直接アクセスで sync を実現する層（Express 完全不要）。
//
// 既存 syncService.ts (apiFetch ベース) と並存する形で導入。Dropbox ログイン済みなら
// こちらが優先、未ログインなら既存 syncService（Railway 経由）にフォールバック。
//
// 設計：
//   - pullAll(): Dropbox の projects-index.json + 各 project doc を読み、IndexedDB に upsert
//   - pushProject(): IndexedDB から project + lyrics + markers を集めて 1 つの JSON を Dropbox に save
//   - deleteProject(): Dropbox の deletions.json に id を追加 + index から外す
//
// 同期戦略：Last-Write-Wins。一人運用前提なので CRDT 不採用。

import { getDropboxClient, isDropboxLoggedIn } from "./dropboxAuth";
import {
  ensureTelopDataFolder,
  loadProjectsIndex,
  loadProjectDoc,
  saveProjectDoc,
  loadDeletions,
  recordDeletion,
  type ProjectFullDoc,
} from "./dropboxStorage";
import { storage } from "./storage";
import type { Project } from "@shared/schema";

export interface DropboxPullResult {
  added: number;
  updated: number;
  deleted: number;
  errors: number;
}

export async function dropboxPullAll(): Promise<DropboxPullResult> {
  const dbx = await getDropboxClient();
  if (!dbx) throw new Error("Dropbox not logged in");
  await ensureTelopDataFolder(dbx);

  const result: DropboxPullResult = { added: 0, updated: 0, deleted: 0, errors: 0 };

  // 1. 削除墓標を先に処理（ゾンビ復活防止）
  const deletions = await loadDeletions(dbx);
  for (const id of deletions.ids) {
    const local = await storage.getProject(id);
    if (local) {
      try {
        await storage.deleteProject(id);
        await storage.recordDeletion(id);
        result.deleted++;
      } catch (err) {
        console.warn(`[dropbox-sync] delete ${id} failed:`, err);
        result.errors++;
      }
    }
  }

  // 2. project index を読んで、各 project の最新 doc を pull
  const index = await loadProjectsIndex(dbx);
  for (const entry of index.entries) {
    if (deletions.ids.includes(entry.id)) continue;
    try {
      const local = await storage.getProject(entry.id);
      // updatedAt 比較で「サーバが新しい」場合のみ pull（無駄を省く）
      if (local) {
        const localUpdated = new Date(local.updatedAt || 0).getTime();
        const remoteUpdated = new Date(entry.updatedAt || 0).getTime();
        if (remoteUpdated <= localUpdated) continue;
      }

      const doc = await loadProjectDoc(dbx, entry.id);
      if (!doc) continue;

      // project meta upsert
      if (local) {
        await storage.updateProject(entry.id, doc.project);
        result.updated++;
      } else {
        await storage.createProject(doc.project);
        result.added++;
      }

      // lyrics 一括 upsert
      if (Array.isArray(doc.lyrics)) {
        await storage.setLyricLines(entry.id, doc.lyrics.map(l => ({
          text: l.text,
          lineIndex: l.lineIndex,
          startTime: l.startTime,
          endTime: l.endTime,
          fadeIn: l.fadeIn,
          fadeOut: l.fadeOut,
          fontSize: l.fontSize,
          blankBefore: l.blankBefore,
        })));
      }

      // audioTracks meta upsert
      if (Array.isArray(doc.audioTracksMeta)) {
        for (const m of doc.audioTracksMeta) {
          await storage.upsertAudioTrackMeta({
            id: m.id,
            projectId: entry.id,
            label: m.label,
            fileName: m.fileName,
            mimeType: m.mimeType,
            createdAt: m.createdAt,
            dropboxPath: (m as any).dropboxPath,
          });
        }
      }

      // markers
      if (Array.isArray(doc.markers)) {
        await storage.setCheckMarkers(entry.id, doc.markers);
      }
    } catch (err) {
      console.warn(`[dropbox-sync] pull ${entry.id} failed:`, err);
      result.errors++;
    }
  }

  return result;
}

export async function dropboxPushProject(projectId: string): Promise<void> {
  const dbx = await getDropboxClient();
  if (!dbx) throw new Error("Dropbox not logged in");
  await ensureTelopDataFolder(dbx);

  const project = await storage.getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found locally`);

  const lyrics = await storage.getLyricLines(projectId);
  const audioTracks = await storage.getAudioTracks(projectId);
  const markers = await storage.getCheckMarkers(projectId);

  const doc: ProjectFullDoc = {
    _version: 1,
    project: project as Project,
    lyrics: lyrics as any,
    audioTracksMeta: audioTracks.map(t => ({
      id: t.id,
      projectId,
      label: t.label,
      fileName: t.fileName,
      mimeType: t.mimeType,
      createdAt: t.createdAt,
      dropboxPath: t.dropboxPath,
    })) as any,
    markers: markers.map(m => ({ id: m.id, time: m.time })),
    savedAt: new Date().toISOString(),
  };

  await saveProjectDoc(dbx, doc);
}

export async function dropboxDeleteProject(projectId: string): Promise<void> {
  const dbx = await getDropboxClient();
  if (!dbx) throw new Error("Dropbox not logged in");
  await recordDeletion(dbx, projectId);
}

export function isDropboxSyncAvailable(): boolean {
  return isDropboxLoggedIn();
}
