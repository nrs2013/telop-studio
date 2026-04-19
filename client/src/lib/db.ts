import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface TelopProject {
  id: string;
  name: string;
  audioFileName: string | null;
  audioDuration: number | null;
  activeAudioTrackId: string | null;
  fontSize: number;
  fontFamily: string;
  fontColor: string;
  strokeColor: string;
  strokeWidth: number;
  strokeBlur: number;
  textAlign: string;
  textX: number | null;
  textY: number | null;
  outputWidth: number;
  outputHeight: number;
  songTitle: string | null;
  lyricsCredit: string | null;
  musicCredit: string | null;
  arrangementCredit: string | null;
  membersCredit: string | null;
  preset: string;
  motifColor: string;
  audioTrimStart: number;
  detectedBpm: number | null;
  creditLineY: number;
  creditInTime: number | null;
  creditOutTime: number | null;
  creditAnimDuration: number | null;
  bpmGridOffset: number;
  creditTitleFontSize: number;
  creditLyricsFontSize: number;
  creditMusicFontSize: number;
  creditArrangementFontSize: number;
  creditMembersFontSize: number;
  creditRightTitleFontSize: number;
  creditHoldStartMs: number | null;
  creditWipeStartMs: number | null;
  creditRightTitle: string | null;
  creditRightTitleAnimDuration: number | null;
  creditTitleLayout: number;
  createdAt: string;
  updatedAt: string;
}

export interface TelopLyricLine {
  id: string;
  projectId: string;
  lineIndex: number;
  text: string;
  startTime: number | null;
  endTime: number | null;
  fadeIn: number;
  fadeOut: number;
  fontSize: number | null;
  blankBefore: boolean;
}

export interface TelopAudio {
  projectId: string;
  fileName: string;
  blob: Blob | ArrayBuffer;
  mimeType: string;
}

export interface TelopAudioTrack {
  id: string;
  projectId: string;
  label: string;
  fileName: string;
  blob: ArrayBuffer;
  mimeType: string;
  createdAt: string;
  dropboxPath?: string;
}

export interface TelopCheckMarker {
  id: string;
  projectId: string;
  time: number;
}

interface TelopDBSchema extends DBSchema {
  projects: {
    key: string;
    value: TelopProject;
    indexes: { "by-created": string };
  };
  lyrics: {
    key: string;
    value: TelopLyricLine;
    indexes: {
      "by-project": string;
      "by-project-index": [string, number];
    };
  };
  audio: {
    key: string;
    value: TelopAudio;
  };
  audioTracks: {
    key: string;
    value: TelopAudioTrack;
    indexes: { "by-project": string };
  };
  checkMarkers: {
    key: string;
    value: TelopCheckMarker;
    indexes: { "by-project": string };
  };
}

const DB_NAME = "telop-studio";
const DB_VERSION = 3;

let dbInstance: IDBPDatabase<TelopDBSchema> | null = null;

export async function getDB(): Promise<IDBPDatabase<TelopDBSchema>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<TelopDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains("projects")) {
        const projectStore = db.createObjectStore("projects", { keyPath: "id" });
        projectStore.createIndex("by-created", "createdAt");
      }

      if (!db.objectStoreNames.contains("lyrics")) {
        const lyricsStore = db.createObjectStore("lyrics", { keyPath: "id" });
        lyricsStore.createIndex("by-project", "projectId");
        lyricsStore.createIndex("by-project-index", ["projectId", "lineIndex"]);
      }

      if (!db.objectStoreNames.contains("audio")) {
        db.createObjectStore("audio", { keyPath: "projectId" });
      }

      if (!db.objectStoreNames.contains("audioTracks")) {
        const trackStore = db.createObjectStore("audioTracks", { keyPath: "id" });
        trackStore.createIndex("by-project", "projectId");
      }

      if (!db.objectStoreNames.contains("checkMarkers")) {
        const markerStore = db.createObjectStore("checkMarkers", { keyPath: "id" });
        markerStore.createIndex("by-project", "projectId");
      }

      if (oldVersion < 2) {
        try {
          const audioStore = transaction.objectStore("audio");
          const projectStore = transaction.objectStore("projects");
          const trackStore = transaction.objectStore("audioTracks");
          const allAudioReq = audioStore.getAll();
          allAudioReq.then(async (allAudio) => {
            for (const audio of allAudio) {
              if (!audio.blob || (audio.blob instanceof ArrayBuffer && audio.blob.byteLength === 0)) continue;
              let arrayBuffer: ArrayBuffer;
              if (audio.blob instanceof ArrayBuffer) {
                arrayBuffer = audio.blob;
              } else if (audio.blob instanceof Blob) {
                try { arrayBuffer = await audio.blob.arrayBuffer(); } catch { continue; }
              } else {
                continue;
              }
              const trackId = crypto.randomUUID();
              await trackStore.put({
                id: trackId,
                projectId: audio.projectId,
                label: audio.fileName || "Track 1",
                fileName: audio.fileName || "audio.mp3",
                blob: arrayBuffer,
                mimeType: audio.mimeType || "audio/mpeg",
                createdAt: new Date().toISOString(),
              });
              const project = await projectStore.get(audio.projectId);
              if (project) {
                project.activeAudioTrackId = trackId;
                await projectStore.put(project);
              }
            }
          }).catch(e => console.warn("Audio migration error:", e));
        } catch (e) {
          console.warn("Audio migration setup error:", e);
        }
      }
    },
  });

  return dbInstance;
}

export function generateId(): string {
  return crypto.randomUUID();
}
