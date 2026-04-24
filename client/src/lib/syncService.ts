import { storage } from "./storage";
import type { Project, LyricLine } from "@shared/schema";

export interface SyncStatus {
  online: boolean;
  loggedIn: boolean;
  lastSyncedAt: string | null;
  syncing: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName?: string;
}

async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    credentials: "include",
  });
  return res;
}

let autoPushTimer: ReturnType<typeof setTimeout> | null = null;
let autoPushProjectId: string | null = null;
let recordingActive = false;
let autoSyncInterval: ReturnType<typeof setInterval> | null = null;
let autoPushCallback: (() => void) | null = null;
let isSyncing = false;
const dirtyProjects = new Set<string>();

const AUTO_PUSH_DELAY = 3000;
const AUTO_SYNC_INTERVAL = 120000;

export const syncService = {
  async checkAuth(): Promise<AuthUser | null> {
    try {
      const res = await apiFetch("/api/auth/me");
      if (!res.ok) return null;
      const data = await res.json();
      return data.user || null;
    } catch {
      return null;
    }
  },

  // Previously this attempted automatic login with a hardcoded team password (insecure).
  // Now it only returns the existing session, if any. Users must explicitly log in.
  async autoLogin(): Promise<AuthUser | null> {
    try {
      const existing = await this.checkAuth();
      return existing || null;
    } catch {
      return null;
    }
  },

  async login(username: string, password: string): Promise<AuthUser> {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "ログインに失敗しました");
    }
    return res.json();
  },

  async register(username: string, password: string, displayName?: string): Promise<AuthUser> {
    const res = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, displayName }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "登録に失敗しました");
    }
    return res.json();
  },

  async logout(): Promise<void> {
    await apiFetch("/api/auth/logout", { method: "POST" });
  },

  async pushProject(projectId: string): Promise<{ success: boolean; version?: number; message?: string }> {
    const project = await storage.getProject(projectId);
    if (!project) throw new Error("Project not found");

    const lyrics = await storage.getLyricLines(projectId);
    const audioTracks = await storage.getAudioTracks(projectId);
    const markers = await storage.getCheckMarkers(projectId);

    const res = await apiFetch("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({
        project: {
          id: project.id,
          name: project.name,
          audioFileName: project.audioFileName,
          audioDuration: project.audioDuration,
          activeAudioTrackId: project.activeAudioTrackId,
          fontSize: project.fontSize,
          fontFamily: project.fontFamily,
          fontColor: project.fontColor,
          strokeColor: project.strokeColor,
          strokeWidth: project.strokeWidth,
          strokeBlur: project.strokeBlur,
          textAlign: project.textAlign,
          textX: project.textX,
          textY: project.textY,
          outputWidth: project.outputWidth,
          outputHeight: project.outputHeight,
          songTitle: project.songTitle,
          lyricsCredit: project.lyricsCredit,
          musicCredit: project.musicCredit,
          arrangementCredit: project.arrangementCredit,
          membersCredit: project.membersCredit,
          preset: project.preset,
          motifColor: project.motifColor,
          audioTrimStart: project.audioTrimStart,
          detectedBpm: project.detectedBpm,
          creditLineY: project.creditLineY,
          creditInTime: project.creditInTime,
          creditOutTime: project.creditOutTime,
          creditAnimDuration: project.creditAnimDuration,
          bpmGridOffset: project.bpmGridOffset,
          creditTitleFontSize: project.creditTitleFontSize,
          creditLyricsFontSize: project.creditLyricsFontSize,
          creditMusicFontSize: project.creditMusicFontSize,
          creditArrangementFontSize: project.creditArrangementFontSize,
          creditMembersFontSize: project.creditMembersFontSize,
          creditRightTitleFontSize: project.creditRightTitleFontSize,
          creditHoldStartMs: project.creditHoldStartMs,
          creditWipeStartMs: project.creditWipeStartMs,
          creditRightTitle: project.creditRightTitle,
          creditRightTitleAnimDuration: project.creditRightTitleAnimDuration,
          creditTitleLayout: project.creditTitleLayout ?? 1,
          version: (project as any).version || 0,
        },
        lyrics: lyrics.map(l => ({
          id: l.id,
          projectId: l.projectId,
          lineIndex: l.lineIndex,
          text: l.text,
          startTime: l.startTime,
          endTime: l.endTime,
          fadeIn: l.fadeIn,
          fadeOut: l.fadeOut,
          fontSize: l.fontSize || null,
          blankBefore: l.blankBefore || false,
        })),
        audioTracks: audioTracks.map(t => ({
          id: t.id,
          label: t.label,
          fileName: t.fileName,
          mimeType: "audio/mpeg",
          createdAt: t.createdAt,
          dropboxPath: (t as any).dropboxPath || undefined,
        })),
        markers: markers.map(m => ({
          id: m.id,
          time: m.time,
        })),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      // Version conflict: rebase local version to server's, then retry once. If the retry
      // also conflicts, surface the error to the user instead of looping forever.
      if (res.status === 409 && data.serverVersion) {
        await storage.updateProject(projectId, { version: data.serverVersion } as any);
        const retryProject = await storage.getProject(projectId);
        if (retryProject) {
          const retryBody = JSON.parse(JSON.stringify({
            project: {
              ...JSON.parse(JSON.stringify(retryProject)),
              version: data.serverVersion,
            },
            lyrics: (await storage.getLyricLines(projectId)).map(l => ({
              id: l.id, projectId: l.projectId, lineIndex: l.lineIndex,
              text: l.text, startTime: l.startTime, endTime: l.endTime,
              fadeIn: l.fadeIn, fadeOut: l.fadeOut,
              fontSize: l.fontSize || null,
              blankBefore: l.blankBefore || false,
            })),
            audioTracks: (await storage.getAudioTracks(projectId)).map(t => ({
              id: t.id, label: t.label, fileName: t.fileName,
              mimeType: "audio/mpeg", createdAt: t.createdAt,
              dropboxPath: (t as any).dropboxPath || undefined,
            })),
            markers: (await storage.getCheckMarkers(projectId)).map(m => ({
              id: m.id, time: m.time,
            })),
          }));
          const retryRes = await apiFetch("/api/sync/push", {
            method: "POST",
            body: JSON.stringify(retryBody),
          });
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            if (retryData.version) {
              await storage.updateProject(projectId, { version: retryData.version } as any);
              return { success: true, version: retryData.version };
            }
          }
          // Retry also failed (likely another concurrent editor). Stop retrying.
          const retryData = await retryRes.json().catch(() => ({}));
          return {
            success: false,
            message: retryData?.message || "他の人が同時に編集しています。少し待ってから再度保存してください。",
          };
        }
      }
      return { success: false, message: data.message };
    }
    if (data.version) {
      await storage.updateProject(projectId, { version: data.version } as any);
    }
    return { success: true, version: data.version };
  },

  async pullAll(): Promise<{ projects: any[]; lyrics: Record<string, any[]>; audioTracks: Record<string, any[]>; markers: Record<string, any[]> }> {
    const res = await apiFetch("/api/sync/pull-all");
    if (!res.ok) throw new Error("Pull failed");
    return res.json();
  },

  async pullAndMergeToLocal(): Promise<{ added: number; updated: number }> {
    const serverData = await this.pullAll();
    let added = 0;
    let updated = 0;

    for (const sp of serverData.projects) {
      const localProject = await storage.getProject(sp.id);
      const projectData: Partial<Project> & { name: string; version?: number } = {
        name: sp.name,
        version: sp.version ?? 1,
        audioFileName: sp.audio_file_name || sp.audioFileName,
        audioDuration: sp.audio_duration || sp.audioDuration,
        activeAudioTrackId: sp.active_audio_track_id || sp.activeAudioTrackId,
        fontSize: sp.font_size ?? sp.fontSize ?? 48,
        fontFamily: sp.font_family || sp.fontFamily || "Noto Sans JP",
        fontColor: sp.font_color || sp.fontColor || "#FFFFFF",
        strokeColor: sp.stroke_color || sp.strokeColor || "#000000",
        strokeWidth: sp.stroke_width ?? sp.strokeWidth ?? 2,
        strokeBlur: sp.stroke_blur ?? sp.strokeBlur ?? 8,
        textAlign: sp.text_align || sp.textAlign || "center",
        textX: sp.text_x ?? sp.textX,
        textY: sp.text_y ?? sp.textY,
        outputWidth: sp.output_width ?? sp.outputWidth ?? 1920,
        outputHeight: sp.output_height ?? sp.outputHeight ?? 1080,
        songTitle: sp.song_title || sp.songTitle,
        lyricsCredit: sp.lyrics_credit || sp.lyricsCredit,
        musicCredit: sp.music_credit || sp.musicCredit,
        arrangementCredit: sp.arrangement_credit || sp.arrangementCredit,
        membersCredit: sp.members_credit || sp.membersCredit,
        preset: sp.preset || "other",
        motifColor: sp.motif_color || sp.motifColor || "#4466FF",
        audioTrimStart: sp.audio_trim_start ?? sp.audioTrimStart ?? 0,
        detectedBpm: sp.detected_bpm ?? sp.detectedBpm,
        creditLineY: sp.credit_line_y ?? sp.creditLineY ?? 80,
        creditInTime: sp.credit_in_time ?? sp.creditInTime,
        creditOutTime: sp.credit_out_time ?? sp.creditOutTime,
        creditAnimDuration: sp.credit_anim_duration ?? sp.creditAnimDuration,
        bpmGridOffset: sp.bpm_grid_offset ?? sp.bpmGridOffset ?? 0,
        creditTitleFontSize: sp.credit_title_font_size ?? sp.creditTitleFontSize ?? 64,
        creditLyricsFontSize: sp.credit_lyrics_font_size ?? sp.creditLyricsFontSize ?? 36,
        creditMusicFontSize: sp.credit_music_font_size ?? sp.creditMusicFontSize ?? 36,
        creditArrangementFontSize: sp.credit_arrangement_font_size ?? sp.creditArrangementFontSize ?? 36,
        creditMembersFontSize: sp.credit_members_font_size ?? sp.creditMembersFontSize ?? 36,
        creditRightTitleFontSize: sp.credit_right_title_font_size ?? sp.creditRightTitleFontSize ?? 38,
        creditHoldStartMs: sp.credit_hold_start_ms ?? sp.creditHoldStartMs,
        creditWipeStartMs: sp.credit_wipe_start_ms ?? sp.creditWipeStartMs,
        creditRightTitle: sp.credit_right_title ?? sp.creditRightTitle,
        creditRightTitleAnimDuration: sp.credit_right_title_anim_duration ?? sp.creditRightTitleAnimDuration,
        creditTitleLayout: sp.credit_title_layout ?? sp.creditTitleLayout ?? 1,
      };

      if (!localProject) {
        await storage.createProject({ ...projectData, id: sp.id });
        added++;
      } else if (dirtyProjects.has(sp.id)) {
        console.log("[AutoSync] Skipping pull for dirty project:", sp.id);
      } else {
        const mergedData = { ...projectData };
        for (const key of Object.keys(mergedData) as (keyof typeof mergedData)[]) {
          const serverVal = mergedData[key];
          const localVal = (localProject as any)[key];
          if ((serverVal === null || serverVal === undefined) && localVal !== null && localVal !== undefined) {
            (mergedData as any)[key] = localVal;
          }
        }
        await storage.updateProject(sp.id, mergedData);
        updated++;
      }

      const serverLyrics = serverData.lyrics[sp.id] || [];
      if (serverLyrics.length > 0 && !dirtyProjects.has(sp.id)) {
        const sortedServerLyrics = [...serverLyrics].sort((a: any, b: any) => (a.line_index ?? a.lineIndex ?? 0) - (b.line_index ?? b.lineIndex ?? 0));
        const serverHasTiming = sortedServerLyrics.some((l: any) => {
          const st = l.start_time ?? l.startTime;
          return st !== null && st !== undefined && st > 0;
        });
        const localLyrics = await storage.getLyricLines(sp.id);
        const localHasTiming = localLyrics.some(l => l.startTime !== null && l.startTime !== undefined && l.startTime > 0);

        if (!localHasTiming || serverHasTiming) {
          const lines = sortedServerLyrics.map((l: any, i: number) => ({
              text: l.text || "",
              lineIndex: i,
              startTime: (l.start_time ?? l.startTime) ?? null,
              endTime: (l.end_time ?? l.endTime) ?? null,
              fadeIn: l.fade_in ?? l.fadeIn ?? 0,
              fadeOut: l.fade_out ?? l.fadeOut ?? 0,
              fontSize: l.font_size ?? l.fontSize ?? null,
              blankBefore: !!(l.blank_before ?? l.blankBefore),
            }));
          await storage.setLyricLines(sp.id, lines);
        } else {
          console.log("[AutoSync] Preserving local timing data for", sp.id, "(server has no timing)");
          this.schedulePush(sp.id);
        }
      }

      // Audio track metadata sync. The same dirty-project guard the
      // project and lyrics branches use (lines 289-290 and 305-329) has
      // to apply here too — otherwise a user's manual Dropbox re-link
      // gets silently overwritten by the next autoSync pull before the
      // schedulePush has had time to flush the new dropboxPath to the
      // server. Symptom reported in production: the link reverts after
      // about a minute (the autoSync interval) back to whatever the
      // server still has stored.
      const serverAudioTracks = serverData.audioTracks[sp.id] || [];
      if (!dirtyProjects.has(sp.id)) {
        for (const sat of serverAudioTracks) {
          await storage.upsertAudioTrackMeta({
            id: sat.id,
            projectId: sp.id,
            label: sat.label,
            fileName: sat.file_name || sat.fileName,
            mimeType: sat.mime_type || sat.mimeType || "audio/mpeg",
            createdAt: sat.created_at || sat.createdAt || new Date().toISOString(),
            dropboxPath: sat.dropbox_path || sat.dropboxPath || undefined,
          });
        }
      } else {
        console.log("[AutoSync] Skipping audio-track pull for dirty project:", sp.id);
        // Make sure the pending local changes still get pushed; the dirty
        // flag alone doesn't trigger a push on its own.
        this.schedulePush(sp.id);
      }

      const serverMarkers = (serverData.markers || {})[sp.id] || [];
      if (serverMarkers.length > 0 && !dirtyProjects.has(sp.id)) {
        await storage.setCheckMarkers(sp.id, serverMarkers.map((m: any) => ({
          id: m.id,
          time: m.time,
        })));
      }
    }

    return { added, updated };
  },

  markDirty(projectId: string) {
    dirtyProjects.add(projectId);
  },

  isDirty(projectId: string): boolean {
    return dirtyProjects.has(projectId);
  },

  async immediatePush(projectId: string) {
    dirtyProjects.add(projectId);
    if (autoPushTimer) clearTimeout(autoPushTimer);
    autoPushTimer = null;
    autoPushProjectId = null;
    if (isSyncing) {
      await new Promise(resolve => {
        const check = () => {
          if (!isSyncing) resolve(undefined);
          else setTimeout(check, 100);
        };
        setTimeout(check, 100);
      });
    }
    isSyncing = true;
    try {
      const user = await this.checkAuth();
      if (!user || !navigator.onLine) return;
      await this.pushProject(projectId);
      dirtyProjects.delete(projectId);
      console.log("[AutoSync] Immediate push completed for", projectId);
    } catch (err: any) {
      console.warn("[AutoSync] Immediate push failed:", err.message);
    } finally {
      isSyncing = false;
    }
  },

  schedulePush(projectId: string, onComplete?: () => void) {
    if (recordingActive) {
      dirtyProjects.add(projectId);
      return;
    }
    dirtyProjects.add(projectId);
    if (autoPushTimer) clearTimeout(autoPushTimer);
    autoPushProjectId = projectId;
    if (onComplete) autoPushCallback = onComplete;
    autoPushTimer = setTimeout(async () => {
      if (!autoPushProjectId) return;
      if (isSyncing) {
        this.schedulePush(autoPushProjectId, autoPushCallback || undefined);
        return;
      }
      isSyncing = true;
      const pid = autoPushProjectId;
      const cb = autoPushCallback;
      autoPushCallback = null;
      try {
        const user = await this.checkAuth();
        if (!user || !navigator.onLine) return;
        await this.pushProject(pid);
        dirtyProjects.delete(pid);
        console.log("[AutoSync] Push completed for", pid);
        if (cb) cb();
      } catch (err: any) {
        console.warn("[AutoSync] Push failed:", err.message);
      } finally {
        isSyncing = false;
        autoPushTimer = null;
      }
    }, AUTO_PUSH_DELAY);
  },

  cancelScheduledPush() {
    if (autoPushTimer) {
      clearTimeout(autoPushTimer);
      autoPushTimer = null;
    }
    autoPushProjectId = null;
    autoPushCallback = null;
  },

  flushScheduledPush() {
    if (autoPushTimer && autoPushProjectId) {
      clearTimeout(autoPushTimer);
      autoPushTimer = null;
      const pid = autoPushProjectId;
      autoPushProjectId = null;
      autoPushCallback = null;
      this.immediatePush(pid);
    }
  },

  setRecording(active: boolean) {
    recordingActive = active;
    if (active) {
      console.log("[AutoSync] Recording started - sync paused");
    } else {
      console.log("[AutoSync] Recording stopped - sync resumed");
    }
  },

  startAutoSync(onPull?: () => void) {
    this.stopAutoSync();
    autoSyncInterval = setInterval(async () => {
      if (recordingActive) {
        console.log("[AutoSync] Skipping periodic sync during recording");
        return;
      }
      if (isSyncing || !navigator.onLine) return;
      isSyncing = true;
      try {
        const user = await this.checkAuth();
        if (!user) return;
        for (const pid of Array.from(dirtyProjects)) {
          try {
            await this.pushProject(pid);
            dirtyProjects.delete(pid);
            console.log("[AutoSync] Periodic push for dirty project:", pid);
          } catch (e: any) {
            console.warn("[AutoSync] Periodic push failed for", pid, e.message);
          }
        }
        await this.pullAndMergeToLocal();
        console.log("[AutoSync] Periodic pull completed");
        if (onPull) onPull();
      } catch (err: any) {
        console.warn("[AutoSync] Periodic pull failed:", err.message);
      } finally {
        isSyncing = false;
      }
    }, AUTO_SYNC_INTERVAL);
  },

  stopAutoSync() {
    if (autoSyncInterval) {
      clearInterval(autoSyncInterval);
      autoSyncInterval = null;
    }
  },

  async autoSyncOnOpen(onResult?: (result: { added: number; updated: number }) => void): Promise<void> {
    if (!navigator.onLine) return;
    try {
      const user = await this.checkAuth();
      if (!user) return;
      const result = await this.pullAndMergeToLocal();
      console.log("[AutoSync] Initial pull:", result);
      // Retroactive fix: push any projects that exist only in this browser's
      // IndexedDB but never made it to the server. Prior to this fix, creating
      // or importing a project on the home page did not trigger a server push
      // until the user opened the editor.
      await this.pushLocalOnlyProjects().catch(err => {
        console.warn("[AutoSync] local-only push failed:", err.message);
      });
      if (onResult) onResult(result);
    } catch (err: any) {
      console.warn("[AutoSync] Initial pull failed:", err.message);
    }
  },

  async pushLocalOnlyProjects(): Promise<number> {
    const user = await this.checkAuth();
    if (!user || !navigator.onLine) return 0;
    let pushed = 0;
    try {
      const serverData = await this.pullAll();
      const serverIds = new Set(serverData.projects.map((p: any) => p.id));
      const localProjects = await storage.getProjects();
      for (const lp of localProjects) {
        if (!serverIds.has(lp.id)) {
          try {
            await this.pushProject(lp.id);
            pushed++;
            console.log("[AutoSync] Pushed local-only project:", lp.id, lp.name);
          } catch (err: any) {
            console.warn("[AutoSync] Failed to push local-only project:", lp.id, err.message);
          }
        }
      }
    } catch (err: any) {
      console.warn("[AutoSync] pushLocalOnlyProjects failed:", err.message);
    }
    return pushed;
  },

  isOnline(): boolean {
    return navigator.onLine;
  },
};
