import { getDB, generateId, type TelopProject, type TelopLyricLine, type TelopAudio, type TelopAudioTrack, type TelopCheckMarker } from "./db";

const PROJECT_DEFAULTS: Omit<TelopProject, "id" | "name" | "createdAt" | "updatedAt"> = {
  audioFileName: null,
  audioDuration: null,
  activeAudioTrackId: null,
  fontSize: 48,
  fontFamily: "Noto Sans JP",
  fontColor: "#FFFFFF",
  strokeColor: "#000000",
  strokeWidth: 2,
  strokeBlur: 8,
  textAlign: "center",
  textX: null,
  textY: null,
  outputWidth: 1920,
  outputHeight: 1080,
  songTitle: null,
  lyricsCredit: null,
  musicCredit: null,
  arrangementCredit: null,
  membersCredit: null,
  preset: "other",
  motifColor: "#4466FF",
  audioTrimStart: 0,
  detectedBpm: null,
  creditLineY: 80,
  creditInTime: null,
  creditOutTime: null,
  creditAnimDuration: null,
  bpmGridOffset: 0,
  creditTitleFontSize: 64,
  creditLyricsFontSize: 36,
  creditMusicFontSize: 36,
  creditArrangementFontSize: 36,
  creditMembersFontSize: 36,
  creditRightTitleFontSize: 38,
  creditHoldStartMs: null,
  creditWipeStartMs: null,
  creditRightTitle: null,
  creditRightTitleAnimDuration: null,
  creditTitleLayout: 1,
};

export const storage = {
  async getProjects(): Promise<TelopProject[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex("projects", "by-created");
    return all.map(p => ({ ...PROJECT_DEFAULTS, ...p }));
  },

  async getProject(id: string): Promise<TelopProject | undefined> {
    const db = await getDB();
    const p = await db.get("projects", id);
    if (!p) return undefined;
    if (p.creditWipeStartMs === 5500 && (!p.creditAnimDuration || p.creditAnimDuration === 6700)) {
      p.creditWipeStartMs = null as any;
      await db.put("projects", p);
    }
    return { ...PROJECT_DEFAULTS, ...p };
  },

  async createProject(data: Partial<TelopProject> & { name: string }): Promise<TelopProject> {
    const db = await getDB();
    const now = new Date().toISOString();
    const project: TelopProject = {
      ...PROJECT_DEFAULTS,
      ...data,
      id: data.id || generateId(),
      createdAt: data.createdAt || now,
      updatedAt: now,
    };
    await db.put("projects", project);
    return project;
  },

  async updateProject(id: string, data: Partial<TelopProject>): Promise<TelopProject | undefined> {
    const db = await getDB();
    const existing = await db.get("projects", id);
    if (!existing) return undefined;
    const updated: TelopProject = {
      ...existing,
      ...data,
      id,
      updatedAt: new Date().toISOString(),
    };
    await db.put("projects", updated);
    return updated;
  },

  async deleteProject(id: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(["projects", "lyrics", "audio", "audioTracks", "checkMarkers"], "readwrite");

    const lyricsIndex = tx.objectStore("lyrics").index("by-project");
    let cursor = await lyricsIndex.openCursor(IDBKeyRange.only(id));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    const tracksIndex = tx.objectStore("audioTracks").index("by-project");
    let trackCursor = await tracksIndex.openCursor(IDBKeyRange.only(id));
    while (trackCursor) {
      await trackCursor.delete();
      trackCursor = await trackCursor.continue();
    }

    const markersIndex = tx.objectStore("checkMarkers").index("by-project");
    let markerCursor = await markersIndex.openCursor(IDBKeyRange.only(id));
    while (markerCursor) {
      await markerCursor.delete();
      markerCursor = await markerCursor.continue();
    }

    await tx.objectStore("audio").delete(id);
    await tx.objectStore("projects").delete(id);
    await tx.done;
  },

  async getLyricLines(projectId: string): Promise<TelopLyricLine[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex("lyrics", "by-project", projectId);
    return all.sort((a, b) => a.lineIndex - b.lineIndex);
  },

  async setLyricLines(
    projectId: string,
    lines: { text: string; lineIndex: number; startTime?: number | null; endTime?: number | null; fadeIn?: number; fadeOut?: number; fontSize?: number | null; blankBefore?: boolean }[]
  ): Promise<TelopLyricLine[]> {
    const db = await getDB();
    const existing = await db.getAllFromIndex("lyrics", "by-project", projectId);
    existing.sort((a, b) => a.lineIndex - b.lineIndex);

    const oldByIndex = new Map(existing.map((e) => [e.lineIndex, e]));
    const oldByText = new Map<string, TelopLyricLine[]>();
    for (const e of existing) {
      if (!oldByText.has(e.text)) oldByText.set(e.text, []);
      oldByText.get(e.text)!.push(e);
    }
    const usedIds = new Set<string>();
    const matchResult: (TelopLyricLine | undefined)[] = lines.map(() => undefined);

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const byIdx = oldByIndex.get(l.lineIndex);
      if (byIdx && byIdx.text === l.text && !usedIds.has(byIdx.id)) {
        matchResult[i] = byIdx;
        usedIds.add(byIdx.id);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      if (matchResult[i]) continue;
      const l = lines[i];
      const candidates = oldByText.get(l.text);
      if (candidates) {
        const found = candidates.find((c) => !usedIds.has(c.id));
        if (found) {
          matchResult[i] = found;
          usedIds.add(found.id);
        }
      }
    }

    const inherited = new Map<
      number,
      { startTime: number | null; endTime: number | null; fadeIn: number; fadeOut: number }
    >();

    // 行分割検出: 1行が2行に分割された場合にタイミングを2分割する
    // 第3パス（インデックスのみマッチ）の前に実行することが重要:
    // 第3パス後だと元の行が usedIds に登録されてしまいスキップされる
    for (const old of existing) {
      if (usedIds.has(old.id)) continue;
      if (old.startTime === null && old.endTime === null) continue;
      for (let i = 0; i < lines.length - 1; i++) {
        if (matchResult[i] && matchResult[i + 1]) continue;
        if (inherited.has(i) || inherited.has(i + 1)) continue;
        const combined = lines[i].text + lines[i + 1].text;
        if (combined === old.text) {
          usedIds.add(old.id);
          if (matchResult[i]) usedIds.delete(matchResult[i]!.id);
          if (matchResult[i + 1]) usedIds.delete(matchResult[i + 1]!.id);
          matchResult[i] = undefined;
          matchResult[i + 1] = undefined;
          const mid =
            old.startTime !== null && old.endTime !== null
              ? old.startTime + (old.endTime - old.startTime) / 2
              : null;
          inherited.set(i, {
            startTime: old.startTime,
            endTime: mid ?? old.endTime,
            fadeIn: old.fadeIn ?? 0,
            fadeOut: 0,
          });
          inherited.set(i + 1, {
            startTime: mid ?? old.startTime,
            endTime: old.endTime,
            fadeIn: 0,
            fadeOut: old.fadeOut ?? 0,
          });
          break;
        }
      }
    }

    // 第3パス: インデックスのみでマッチ（テキスト不一致でも）
    for (let i = 0; i < lines.length; i++) {
      if (matchResult[i] || inherited.has(i)) continue;
      const l = lines[i];
      const byIdx = oldByIndex.get(l.lineIndex);
      if (byIdx && !usedIds.has(byIdx.id)) {
        matchResult[i] = byIdx;
        usedIds.add(byIdx.id);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      if (matchResult[i] || inherited.has(i)) continue;
      const newText = lines[i].text;
      if (!newText) continue;
      for (let j = 0; j < existing.length - 1; j++) {
        const a = existing[j];
        const b = existing[j + 1];
        if (usedIds.has(a.id) || usedIds.has(b.id)) continue;
        if ((a.startTime === null && a.endTime === null) && (b.startTime === null && b.endTime === null)) continue;
        if (a.text + b.text === newText) {
          const st = a.startTime ?? b.startTime;
          const et = b.endTime ?? a.endTime;
          inherited.set(i, {
            startTime: st,
            endTime: et,
            fadeIn: a.fadeIn ?? 0,
            fadeOut: b.fadeOut ?? 0,
          });
          usedIds.add(a.id);
          usedIds.add(b.id);
          break;
        }
      }
    }

    const results: TelopLyricLine[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const match = matchResult[i];
      const inh = inherited.get(i);
      const hasExplicitTiming = l.startTime !== undefined || l.endTime !== undefined;
      const result: TelopLyricLine = {
        id: match ? match.id : generateId(),
        projectId,
        lineIndex: l.lineIndex,
        text: l.text,
        startTime: hasExplicitTiming ? (l.startTime ?? null) : (match?.startTime ?? inh?.startTime ?? null),
        endTime: hasExplicitTiming ? (l.endTime ?? null) : (match?.endTime ?? inh?.endTime ?? null),
        fadeIn: l.fadeIn ?? match?.fadeIn ?? inh?.fadeIn ?? 0,
        fadeOut: l.fadeOut ?? match?.fadeOut ?? inh?.fadeOut ?? 0,
        fontSize: l.fontSize !== undefined ? l.fontSize : (match?.fontSize ?? null),
        blankBefore: l.blankBefore ?? match?.blankBefore ?? false,
      };
      results.push(result);
    }

    const tx = db.transaction("lyrics", "readwrite");
    const store = tx.objectStore("lyrics");
    const indexCursor = store.index("by-project").openCursor(IDBKeyRange.only(projectId));
    let c = await indexCursor;
    while (c) {
      await c.delete();
      c = await c.continue();
    }
    for (const r of results) {
      await store.put(r);
    }
    await tx.done;
    return results;
  },

  async addLyricLines(
    projectId: string,
    lines: { text: string; startTime: number; endTime: number; fadeIn: number; fadeOut: number }[]
  ): Promise<TelopLyricLine[]> {
    const db = await getDB();
    const existing = await db.getAllFromIndex("lyrics", "by-project", projectId);
    let maxIndex = existing.length > 0 ? Math.max(...existing.map((e) => e.lineIndex)) : -1;
    const newLines: TelopLyricLine[] = lines.map((l) => {
      maxIndex++;
      return {
        id: generateId(),
        projectId,
        lineIndex: maxIndex,
        text: l.text,
        startTime: l.startTime,
        endTime: l.endTime,
        fadeIn: l.fadeIn,
        fadeOut: l.fadeOut,
        fontSize: null,
        blankBefore: false,
      };
    });
    const tx = db.transaction("lyrics", "readwrite");
    for (const nl of newLines) {
      await tx.store.put(nl);
    }
    await tx.done;
    return newLines;
  },

  async updateLyricTimings(
    updates: { id: string; startTime: number | null; endTime: number | null }[]
  ): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("lyrics", "readwrite");
    for (const u of updates) {
      const existing = await tx.store.get(u.id);
      if (existing) {
        existing.startTime = u.startTime;
        existing.endTime = u.endTime;
        await tx.store.put(existing);
      }
    }
    await tx.done;
  },

  async updateLyricFades(
    updates: { id: string; fadeIn: number; fadeOut: number }[]
  ): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("lyrics", "readwrite");
    for (const u of updates) {
      const existing = await tx.store.get(u.id);
      if (existing) {
        existing.fadeIn = u.fadeIn;
        existing.fadeOut = u.fadeOut;
        await tx.store.put(existing);
      }
    }
    await tx.done;
  },

  async updateLyricBlankBefore(
    updates: { lyricId: string; blankBefore: boolean }[]
  ): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("lyrics", "readwrite");
    for (const u of updates) {
      const existing = await tx.store.get(u.lyricId);
      if (existing) {
        (existing as any).blankBefore = u.blankBefore;
        await tx.store.put(existing);
      }
    }
    await tx.done;
  },

  async updateLyricOrder(
    updates: { id: string; lineIndex: number; blankBefore: boolean }[]
  ): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("lyrics", "readwrite");
    for (const u of updates) {
      const existing = await tx.store.get(u.id);
      if (existing) {
        existing.lineIndex = u.lineIndex;
        (existing as any).blankBefore = u.blankBefore;
        await tx.store.put(existing);
      }
    }
    await tx.done;
  },

  async updateLyricFontSizes(
    updates: { id: string; fontSize: number | null }[]
  ): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("lyrics", "readwrite");
    for (const u of updates) {
      const existing = await tx.store.get(u.id);
      if (existing) {
        existing.fontSize = u.fontSize;
        await tx.store.put(existing);
      }
    }
    await tx.done;
  },

  async resetLyricTimingsAndFades(
    lyricIds: string[]
  ): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("lyrics", "readwrite");
    for (const id of lyricIds) {
      const existing = await tx.store.get(id);
      if (existing) {
        existing.startTime = null;
        existing.endTime = null;
        existing.fadeIn = 0;
        existing.fadeOut = 0;
        existing.fontSize = null;
        await tx.store.put(existing);
      }
    }
    await tx.done;
  },

  async restoreLyricTimingsAndFades(
    timings: { id: string; startTime: number | null; endTime: number | null }[],
    fades: { id: string; fadeIn: number; fadeOut: number }[],
    fontSizes?: { id: string; fontSize: number | null }[]
  ): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("lyrics", "readwrite");
    const fadeMap = new Map(fades.map(f => [f.id, f]));
    const fontSizeMap = fontSizes ? new Map(fontSizes.map(f => [f.id, f])) : null;
    for (const t of timings) {
      const existing = await tx.store.get(t.id);
      if (existing) {
        existing.startTime = t.startTime;
        existing.endTime = t.endTime;
        const f = fadeMap.get(t.id);
        if (f) {
          existing.fadeIn = f.fadeIn;
          existing.fadeOut = f.fadeOut;
        }
        if (fontSizeMap) {
          const fs = fontSizeMap.get(t.id);
          if (fs) existing.fontSize = fs.fontSize;
        }
        await tx.store.put(existing);
      }
    }
    await tx.done;
  },

  async saveAudio(projectId: string, file: File): Promise<void> {
    const db = await getDB();
    const arrayBuffer = await file.arrayBuffer();
    const audioData: TelopAudio = {
      projectId,
      fileName: file.name,
      blob: arrayBuffer,
      mimeType: file.type || "audio/mpeg",
    };
    await db.put("audio", audioData);
  },

  async getAudio(projectId: string): Promise<{ projectId: string; fileName: string; arrayBuffer: ArrayBuffer; mimeType: string } | undefined> {
    const db = await getDB();
    const record = await db.get("audio", projectId);
    if (!record) return undefined;
    let arrayBuffer: ArrayBuffer;
    if (record.blob instanceof ArrayBuffer) {
      arrayBuffer = record.blob;
    } else if (record.blob instanceof Blob) {
      try {
        arrayBuffer = await record.blob.arrayBuffer();
      } catch {
        try {
          arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(record.blob as Blob);
          });
        } catch {
          return undefined;
        }
      }
    } else if (record.blob && typeof record.blob === "object" && "byteLength" in (record.blob as any)) {
      arrayBuffer = record.blob as unknown as ArrayBuffer;
    } else {
      return undefined;
    }
    if (arrayBuffer.byteLength === 0) return undefined;
    return { projectId: record.projectId, fileName: record.fileName, arrayBuffer, mimeType: record.mimeType };
  },

  async deleteAudio(projectId: string): Promise<void> {
    const db = await getDB();
    await db.delete("audio", projectId);
  },

  async saveAudioBlob(projectId: string, blob: Blob, fileName: string, mimeType?: string): Promise<void> {
    const db = await getDB();
    const arrayBuffer = await blob.arrayBuffer();
    const audioData: TelopAudio = {
      projectId,
      fileName,
      blob: arrayBuffer,
      mimeType: mimeType || "audio/mpeg",
    };
    await db.put("audio", audioData);
  },

  async ensureAudioTrackMigrated(projectId: string): Promise<void> {
    const db = await getDB();
    const tracks = await db.getAllFromIndex("audioTracks", "by-project", projectId);
    if (tracks.length > 0) return;
    const legacy = await db.get("audio", projectId);
    if (!legacy || !legacy.blob) return;
    let arrayBuffer: ArrayBuffer;
    if (legacy.blob instanceof ArrayBuffer) {
      arrayBuffer = legacy.blob;
    } else if (legacy.blob instanceof Blob) {
      try { arrayBuffer = await legacy.blob.arrayBuffer(); } catch { return; }
    } else {
      return;
    }
    if (arrayBuffer.byteLength === 0) return;
    const trackId = generateId();
    const track: TelopAudioTrack = {
      id: trackId,
      projectId,
      label: legacy.fileName || "Track 1",
      fileName: legacy.fileName || "audio.mp3",
      blob: arrayBuffer,
      mimeType: legacy.mimeType || "audio/mpeg",
      createdAt: new Date().toISOString(),
    };
    await db.put("audioTracks", track);
    const project = await db.get("projects", projectId);
    if (project && !project.activeAudioTrackId) {
      project.activeAudioTrackId = trackId;
      await db.put("projects", project);
    }
  },

  async saveAudioTrack(projectId: string, blob: Blob, fileName: string, label: string, mimeType?: string, dropboxPath?: string): Promise<TelopAudioTrack> {
    const db = await getDB();
    const arrayBuffer = await blob.arrayBuffer();
    const track: TelopAudioTrack = {
      id: generateId(),
      projectId,
      label,
      fileName,
      blob: arrayBuffer,
      mimeType: mimeType || "audio/mpeg",
      createdAt: new Date().toISOString(),
      dropboxPath,
    };
    await db.put("audioTracks", track);
    return track;
  },

  async getAudioTracks(projectId: string): Promise<Omit<TelopAudioTrack, "blob">[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex("audioTracks", "by-project", projectId);
    for (const t of all) {
      if (t.dropboxPath && t.dropboxPath.startsWith("/Telop音源/")) {
        t.dropboxPath = `/nrs チーム フォルダ/NEW TELOP${t.dropboxPath}`;
        await db.put("audioTracks", t);
      } else if (t.dropboxPath && t.dropboxPath.startsWith("/nrs チーム フォルダ/Telop音源/")) {
        t.dropboxPath = t.dropboxPath.replace("/nrs チーム フォルダ/Telop音源/", "/nrs チーム フォルダ/NEW TELOP/Telop音源/");
        await db.put("audioTracks", t);
      }
    }
    return all.map(({ blob: _, ...rest }) => rest).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getAudioTrack(trackId: string): Promise<{ id: string; projectId: string; label: string; fileName: string; arrayBuffer: ArrayBuffer; mimeType: string; dropboxPath?: string } | undefined> {
    const db = await getDB();
    const record = await db.get("audioTracks", trackId);
    if (!record) return undefined;
    if (record.dropboxPath && record.dropboxPath.startsWith("/Telop音源/")) {
      record.dropboxPath = `/nrs チーム フォルダ/NEW TELOP${record.dropboxPath}`;
      await db.put("audioTracks", record);
    } else if (record.dropboxPath && record.dropboxPath.startsWith("/nrs チーム フォルダ/Telop音源/")) {
      record.dropboxPath = record.dropboxPath.replace("/nrs チーム フォルダ/Telop音源/", "/nrs チーム フォルダ/NEW TELOP/Telop音源/");
      await db.put("audioTracks", record);
    }
    if (!record.blob || record.blob.byteLength === 0) {
      return {
        id: record.id,
        projectId: record.projectId,
        label: record.label,
        fileName: record.fileName,
        arrayBuffer: new ArrayBuffer(0),
        mimeType: record.mimeType,
        dropboxPath: record.dropboxPath,
      };
    }
    return {
      id: record.id,
      projectId: record.projectId,
      label: record.label,
      fileName: record.fileName,
      arrayBuffer: record.blob,
      mimeType: record.mimeType,
      dropboxPath: record.dropboxPath,
    };
  },

  async deleteAudioTrack(trackId: string): Promise<void> {
    const db = await getDB();
    await db.delete("audioTracks", trackId);
  },

  async duplicateProject(sourceId: string, newName: string): Promise<TelopProject> {
    const db = await getDB();
    const source = await db.get("projects", sourceId);
    if (!source) throw new Error("元のプロジェクトが見つかりません");

    await storage.ensureAudioTrackMigrated(sourceId);

    const sourceLyrics = await db.getAllFromIndex("lyrics", "by-project", sourceId);
    const sourceTracks = await db.getAllFromIndex("audioTracks", "by-project", sourceId);

    const newProjectId = generateId();
    const now = new Date().toISOString();
    const trackIdMap = new Map<string, string>();

    const tx = db.transaction(["projects", "lyrics", "audioTracks"], "readwrite");

    for (const track of sourceTracks) {
      const newTrackId = generateId();
      trackIdMap.set(track.id, newTrackId);
      tx.objectStore("audioTracks").put({
        ...track,
        id: newTrackId,
        projectId: newProjectId,
        createdAt: now,
      });
    }

    const newActiveTrackId = source.activeAudioTrackId
      ? trackIdMap.get(source.activeAudioTrackId) || null
      : null;

    const newProject: TelopProject = {
      ...PROJECT_DEFAULTS,
      ...source,
      id: newProjectId,
      name: newName,
      activeAudioTrackId: newActiveTrackId,
      createdAt: now,
      updatedAt: now,
    };
    tx.objectStore("projects").put(newProject);

    for (const line of sourceLyrics) {
      tx.objectStore("lyrics").put({
        ...line,
        id: generateId(),
        projectId: newProjectId,
      });
    }

    await tx.done;
    return newProject;
  },

  async getFullProjectSnapshot(id: string): Promise<{ project: TelopProject; lyrics: TelopLyricLine[]; audioTracks: TelopAudioTrack[] } | null> {
    const db = await getDB();
    const project = await db.get("projects", id);
    if (!project) return null;
    const lyrics = await db.getAllFromIndex("lyrics", "by-project", id);
    const audioTracks = await db.getAllFromIndex("audioTracks", "by-project", id);
    return { project: { ...PROJECT_DEFAULTS, ...project }, lyrics, audioTracks };
  },

  async restoreFullProjectSnapshot(snapshot: { project: TelopProject; lyrics: TelopLyricLine[]; audioTracks: TelopAudioTrack[] }): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(["projects", "lyrics", "audioTracks"], "readwrite");
    tx.objectStore("projects").put(snapshot.project);
    const existingLyrics = await tx.objectStore("lyrics").index("by-project").getAll(snapshot.project.id);
    for (const l of existingLyrics) {
      tx.objectStore("lyrics").delete(l.id);
    }
    for (const l of snapshot.lyrics) {
      tx.objectStore("lyrics").put(l);
    }
    const existingTracks = await tx.objectStore("audioTracks").index("by-project").getAll(snapshot.project.id);
    for (const t of existingTracks) {
      tx.objectStore("audioTracks").delete(t.id);
    }
    for (const t of snapshot.audioTracks) {
      tx.objectStore("audioTracks").put(t);
    }
    await tx.done;
  },

  async renameAudioTrack(trackId: string, label: string): Promise<void> {
    const db = await getDB();
    const record = await db.get("audioTracks", trackId);
    if (!record) return;
    record.label = label;
    await db.put("audioTracks", record);
  },

  async renameAudioTrackFile(trackId: string, newFileName: string, newDropboxPath?: string): Promise<void> {
    const db = await getDB();
    const record = await db.get("audioTracks", trackId);
    if (!record) return;
    record.fileName = newFileName;
    record.label = newFileName;
    if (newDropboxPath !== undefined) record.dropboxPath = newDropboxPath;
    await db.put("audioTracks", record);
  },

  async updateAudioTrackDropboxPath(trackId: string, dropboxPath: string): Promise<void> {
    const db = await getDB();
    const record = await db.get("audioTracks", trackId);
    if (!record) return;
    record.dropboxPath = dropboxPath;
    await db.put("audioTracks", record);
  },

  async updateAudioTrackBlob(trackId: string, blob: ArrayBuffer): Promise<void> {
    const db = await getDB();
    const record = await db.get("audioTracks", trackId);
    if (!record) return;
    record.blob = blob;
    await db.put("audioTracks", record);
  },

  async countTracksWithDropboxPath(dropboxPath: string, excludeTrackId?: string): Promise<number> {
    const db = await getDB();
    const allTracks = await db.getAll("audioTracks");
    return allTracks.filter(t => t.dropboxPath === dropboxPath && t.id !== excludeTrackId).length;
  },

  async upsertAudioTrackMeta(trackMeta: { id: string; projectId: string; label: string; fileName: string; mimeType: string; createdAt: string; dropboxPath?: string }): Promise<void> {
    const db = await getDB();
    const existing = await db.get("audioTracks", trackMeta.id);
    if (existing) {
      existing.label = trackMeta.label;
      existing.fileName = trackMeta.fileName;
      existing.mimeType = trackMeta.mimeType;
      if (trackMeta.dropboxPath) existing.dropboxPath = trackMeta.dropboxPath;
      await db.put("audioTracks", existing);
    } else {
      const newTrack: TelopAudioTrack = {
        id: trackMeta.id,
        projectId: trackMeta.projectId,
        label: trackMeta.label,
        fileName: trackMeta.fileName,
        blob: new ArrayBuffer(0),
        mimeType: trackMeta.mimeType,
        createdAt: trackMeta.createdAt,
        dropboxPath: trackMeta.dropboxPath,
      };
      await db.put("audioTracks", newTrack);
    }
  },

  async getCheckMarkers(projectId: string): Promise<TelopCheckMarker[]> {
    const db = await getDB();
    return db.getAllFromIndex("checkMarkers", "by-project", projectId);
  },

  async setCheckMarkers(projectId: string, markers: { id: string; time: number }[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("checkMarkers", "readwrite");
    const existing = await tx.store.index("by-project").getAll(projectId);
    for (const m of existing) {
      await tx.store.delete(m.id);
    }
    for (const m of markers) {
      await tx.store.put({ id: m.id, projectId, time: m.time });
    }
    await tx.done;
  },

  async deleteCheckMarkersForProject(projectId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction("checkMarkers", "readwrite");
    const existing = await tx.store.index("by-project").getAll(projectId);
    for (const m of existing) {
      await tx.store.delete(m.id);
    }
    await tx.done;
  },
};
