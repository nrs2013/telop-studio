// Dropbox を「DB」として使う storage 層。
//
// Serverless 化（GitHub Pages + Dropbox 直接アクセス + 月 $0）の中核。
//
// 設計：
//   /TELOP-DATA/projects-index.json
//       → プロジェクト ID 一覧と各 project の最終更新時刻
//       → 一覧表示・存在チェックはこれだけ読めば終わる
//   /TELOP-DATA/projects/<id>.json
//       → 各プロジェクトの全データ（meta + lyrics + audioTracks meta + markers）
//       → 1 プロジェクト = 1 JSON、書き換えは丸ごと replace
//   /TELOP-DATA/deletions.json
//       → 削除済みプロジェクト ID 一覧（ゾンビ復活防止の墓標）
//
// 制約：
//   - Last-Write-Wins（同時編集はレアと割り切る、CRDT 不採用）
//   - 認証は Dropbox OAuth でブラウザから直接
//   - 音源 blob は IndexedDB と Dropbox のオリジナル mp3 で二重管理（既存通り）

import type { Dropbox } from "dropbox";
import type { Project, LyricLine, AudioTrack } from "@shared/schema";

const TELOP_DATA_ROOT = "/TELOP-DATA";
const PROJECTS_INDEX_PATH = `${TELOP_DATA_ROOT}/projects-index.json`;
const PROJECT_DIR = `${TELOP_DATA_ROOT}/projects`;
const DELETIONS_PATH = `${TELOP_DATA_ROOT}/deletions.json`;

export interface ProjectIndexEntry {
  id: string;
  name: string;
  preset: string;
  updatedAt: string; // ISO timestamp
  version: number;
}

export interface ProjectIndex {
  _version: 1;
  entries: ProjectIndexEntry[];
}

export interface ProjectFullDoc {
  _version: 1;
  project: Project;
  lyrics: LyricLine[];
  audioTracksMeta: Array<Omit<AudioTrack, "blob"> & { dropboxPath?: string }>;
  markers: Array<{ id: string; time: number }>;
  savedAt: string;
}

export interface DeletionsDoc {
  _version: 1;
  ids: string[];
}

// ─── Dropbox API ヘルパ（read / write JSON）───────────────────────
// 既存の API ラッパは server 経由なので serverless では使えない。
// ここでは @dropbox/dropbox-sdk-js を直接使う想定で、Dropbox インスタンスを
// 受け取って read / write する。

export async function readJson<T>(dbx: Dropbox, path: string): Promise<T | null> {
  try {
    const res = await dbx.filesDownload({ path });
    // Web SDK では .fileBlob、Node SDK では .fileBinary
    const blob: any = (res.result as any).fileBlob || (res.result as any).fileBinary;
    if (!blob) return null;
    const text = typeof blob.text === "function" ? await blob.text() : blob.toString("utf8");
    return JSON.parse(text) as T;
  } catch (err: any) {
    // 404（not_found）は null を返す。それ以外は throw。
    const status = err?.status || err?.error?.error?.[".tag"];
    if (status === 409 || status === "path" || (typeof err?.error?.error_summary === "string" && err.error.error_summary.includes("not_found"))) {
      return null;
    }
    throw err;
  }
}

export async function writeJson(dbx: Dropbox, path: string, data: any): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  // Web SDK は Blob、Node SDK は Buffer を contents に取る
  const contents: any =
    typeof Blob !== "undefined" ? new Blob([json], { type: "application/json" }) : Buffer.from(json, "utf8");
  await dbx.filesUpload({
    path,
    contents,
    mode: { ".tag": "overwrite" } as any,
    mute: true, // 通知を出さない（DropBox 上にアクティビティを流さない）
    autorename: false,
  });
}

// ─── 高レベル API ───────────────────────────────────────────────

export async function loadProjectsIndex(dbx: Dropbox): Promise<ProjectIndex> {
  const idx = await readJson<ProjectIndex>(dbx, PROJECTS_INDEX_PATH);
  if (idx && idx._version === 1 && Array.isArray(idx.entries)) return idx;
  return { _version: 1, entries: [] };
}

export async function saveProjectsIndex(dbx: Dropbox, idx: ProjectIndex): Promise<void> {
  await writeJson(dbx, PROJECTS_INDEX_PATH, idx);
}

export async function loadProjectDoc(dbx: Dropbox, projectId: string): Promise<ProjectFullDoc | null> {
  return await readJson<ProjectFullDoc>(dbx, `${PROJECT_DIR}/${projectId}.json`);
}

export async function saveProjectDoc(dbx: Dropbox, doc: ProjectFullDoc): Promise<void> {
  await writeJson(dbx, `${PROJECT_DIR}/${doc.project.id}.json`, doc);

  // index も同時更新（最終更新時刻を反映）
  const idx = await loadProjectsIndex(dbx);
  const filtered = idx.entries.filter(e => e.id !== doc.project.id);
  filtered.push({
    id: doc.project.id,
    name: doc.project.name,
    preset: doc.project.preset,
    updatedAt: doc.savedAt,
    version: ((doc.project as any).version ?? 1),
  });
  await saveProjectsIndex(dbx, { _version: 1, entries: filtered });
}

export async function loadDeletions(dbx: Dropbox): Promise<DeletionsDoc> {
  const d = await readJson<DeletionsDoc>(dbx, DELETIONS_PATH);
  if (d && d._version === 1 && Array.isArray(d.ids)) return d;
  return { _version: 1, ids: [] };
}

export async function recordDeletion(dbx: Dropbox, projectId: string): Promise<void> {
  // projects-index から外す
  const idx = await loadProjectsIndex(dbx);
  await saveProjectsIndex(dbx, { _version: 1, entries: idx.entries.filter(e => e.id !== projectId) });

  // 墓標に追加
  const del = await loadDeletions(dbx);
  if (!del.ids.includes(projectId)) {
    del.ids.push(projectId);
    await writeJson(dbx, DELETIONS_PATH, del);
  }

  // プロジェクト本体は残しておく（誤削除時の救済余地）。
  // 必要なら 30 日後に prune する別 job を組む。
}

// ─── 設定の存在チェック ─────────────────────────────────────────
// 初回起動時に「TELOP-DATA フォルダがあるか」「権限が通っているか」をチェック。

export async function ensureTelopDataFolder(dbx: Dropbox): Promise<void> {
  try {
    await dbx.filesCreateFolderV2({ path: TELOP_DATA_ROOT, autorename: false });
  } catch (err: any) {
    // 既にある場合は 409 conflict。無視。
    const summary = err?.error?.error_summary || "";
    if (typeof summary === "string" && summary.includes("conflict")) return;
    // 別のエラー（権限なし等）は呼び出し側に伝える
    throw err;
  }
  try {
    await dbx.filesCreateFolderV2({ path: PROJECT_DIR, autorename: false });
  } catch (err: any) {
    const summary = err?.error?.error_summary || "";
    if (typeof summary === "string" && summary.includes("conflict")) return;
    throw err;
  }
}
