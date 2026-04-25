import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Music, FolderOpen, Upload, Cloud, CloudOff, Pencil, Copy, ChevronDown, ChevronRight, FolderPlus, ArrowUpDown, GripVertical, Undo2, Redo2, Link2, Unlink2 } from "lucide-react";
import type { Project } from "@shared/schema";
import { storage } from "@/lib/storage";
import { syncService } from "@/lib/syncService";
import { homeUndoManager, useUndo } from "@/lib/undoManager";
import { TS_DESIGN } from "@/lib/designTokens";
import { safeSetItem } from "@/lib/safeStorage";

function formatDate(dateStr: string | null) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const COLUMNS = [
  { key: "sakurazaka", label: "SAKURAZAKA 46", color: "hsl(340 65% 42%)" },
  { key: "hinatazaka", label: "HINATAZAKA 46", color: "hsl(200 65% 40%)" },
  { key: "other", label: "OTHER", color: "hsl(260 55% 45%)" },
] as const;

const PRESET_DEFAULTS: Record<string, Partial<Project>> = {
  sakurazaka: {
    fontFamily: "Noto Serif JP",
    fontSize: 72,
    fontColor: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 8,
    strokeBlur: 0,
    textAlign: "left",
    textX: 44,
    textY: 1013,
    creditLineY: 88,
  },
  hinatazaka: {
    fontFamily: "Inter",
    fontSize: 72,
    fontColor: "#FFFFFF",
    strokeColor: "#000000",
    strokeWidth: 8,
    strokeBlur: 0,
    textAlign: "left",
    textX: 44,
    textY: 1013,
    creditLineY: 88,
  },
  other: {},
};

interface ConcertFolder {
  id: string;
  name: string;
  preset: string;
  projectIds: string[];
  collapsed: boolean;
  createdAt: string;
}

function loadFolders(): ConcertFolder[] {
  try {
    const raw = localStorage.getItem("telop-folders");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function getJapaneseReading(name: string): string {
  return name.toLowerCase();
}

function katakanaToGroup(reading: string): string {
  // Normalize to NFC so combining marks (U+3099 dakuten / U+309A handakuten) are
  // composed with their base character before we inspect the first codepoint.
  const normalized = reading.normalize("NFC");
  const first = normalized.charAt(0);
  if (!first) return "#";
  const cp = first.codePointAt(0)!;

  if (cp >= 0x30A1 && cp <= 0x30F6) {
    const groups: [number, number, string][] = [
      [0x30A1, 0x30AA, "ア"], [0x30AB, 0x30B4, "カ"], [0x30B5, 0x30BE, "サ"],
      [0x30BF, 0x30C9, "タ"], [0x30CA, 0x30CE, "ナ"], [0x30CF, 0x30DD, "ハ"],
      [0x30DE, 0x30E2, "マ"], [0x30E3, 0x30E8, "ヤ"], [0x30E9, 0x30ED, "ラ"],
      [0x30EF, 0x30F6, "ワ"],
    ];
    for (const [start, end, label] of groups) {
      if (cp >= start && cp <= end) return label;
    }
    return "ア";
  }

  if (cp >= 0x3041 && cp <= 0x3096) {
    const groups: [number, number, string][] = [
      [0x3041, 0x304A, "ア"], [0x304B, 0x3054, "カ"], [0x3055, 0x305E, "サ"],
      [0x305F, 0x3069, "タ"], [0x306A, 0x306E, "ナ"], [0x306F, 0x307D, "ハ"],
      [0x307E, 0x3082, "マ"], [0x3083, 0x3088, "ヤ"], [0x3089, 0x308D, "ラ"],
      [0x308F, 0x3096, "ワ"],
    ];
    for (const [start, end, label] of groups) {
      if (cp >= start && cp <= end) return label;
    }
    return "ア";
  }

  const upper = first.toUpperCase();
  if (upper >= "A" && upper <= "Z") return upper;
  if (upper >= "0" && upper <= "9") return "#";
  return "#";
}

function getIndexLabel(name: string, readingsMap?: Record<string, string>): string {
  if (!name) return "#";
  const reading = readingsMap?.[name];
  if (reading) return katakanaToGroup(reading);
  return katakanaToGroup(name);
}

const readingsCache: Record<string, string> = {};
async function fetchReadings(names: string[]): Promise<Record<string, string>> {
  const needFetch = names.filter(n => !(n in readingsCache) && n.length > 0);
  if (needFetch.length > 0) {
    try {
      const res = await fetch("/api/reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: needFetch }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.readings) {
          Object.assign(readingsCache, data.readings);
        }
      }
    } catch {}
  }
  return readingsCache;
}

export default function Home() {
  const [, navigate] = useLocation();
  const [newName, setNewName] = useState("");
  const [newPreset, setNewPreset] = useState("other");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [columnDialogPreset, setColumnDialogPreset] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [timingStatus, setTimingStatus] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const telopInputRef = useRef<HTMLInputElement>(null);
  const columnTelopInputRef = useRef<HTMLInputElement>(null);
  const columnImportTargetRef = useRef<string | null>(null);
  const { toast } = useToast();
  const { undo, redo, canUndo, canRedo, push: pushUndo, undoDescription, redoDescription } = useUndo(homeUndoManager);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [dropboxDialogOpen, setDropboxDialogOpen] = useState(false);
  const [dropboxStatus, setDropboxStatus] = useState<{ customConfigured: boolean; customConnected: boolean } | null>(null);
  const [dropboxConnecting, setDropboxConnecting] = useState(false);
  const [editingStatus, setEditingStatus] = useState<Record<string, { editors: string[] }>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [columnDragOver, setColumnDragOver] = useState<string | null>(null);
  const columnDragCounters = useRef<Record<string, number>>({});

  const [sortMode, setSortMode] = useState<"name" | "date">(() => {
    return (localStorage.getItem("telop-sort-mode") as "name" | "date") || "name";
  });
  const [folders, setFolders] = useState<ConcertFolder[]>(() => loadFolders());
  const [folderDialogPreset, setFolderDialogPreset] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderDragOver, setFolderDragOver] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");
  const renameFolderInputRef = useRef<HTMLInputElement>(null);
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [readingsMap, setReadingsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    safeSetItem(
      "telop-sort-mode",
      sortMode,
      (msg) => toast({ title: msg, variant: "destructive" }),
      "並び替え設定",
    );
  }, [sortMode, toast]);

  useEffect(() => {
    safeSetItem(
      "telop-folders",
      JSON.stringify(folders),
      (msg) => toast({ title: msg, variant: "destructive" }),
      "フォルダ一覧",
    );
  }, [folders, toast]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const fetchDropboxStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/dropbox/oauth/status");
      if (res.ok) setDropboxStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchDropboxStatus(); }, [fetchDropboxStatus]);

  const openDropboxConnect = useCallback(() => {
    setDropboxConnecting(true);
    const popup = window.open("/api/dropbox/oauth/start", "dropbox-auth", "width=600,height=700");
    const handler = (e: MessageEvent) => {
      if (e.data === "dropbox-connected") {
        fetchDropboxStatus();
        setDropboxDialogOpen(false);
        toast({ title: "✓ Dropbox接続完了", description: "永続トークンが保存されました。今後は自動的に再接続します。" });
        window.removeEventListener("message", handler);
        setDropboxConnecting(false);
      }
    };
    window.addEventListener("message", handler);
    const check = setInterval(() => {
      if (popup?.closed) {
        clearInterval(check);
        window.removeEventListener("message", handler);
        setDropboxConnecting(false);
        fetchDropboxStatus();
      }
    }, 500);
  }, [fetchDropboxStatus, toast]);

  const disconnectDropbox = useCallback(async () => {
    if (!confirm("Dropboxの接続を切断しますか?\n\n再度接続するには「Dropboxに接続」ボタンを押してください。")) return;
    setDropboxConnecting(true);
    try {
      const res = await fetch("/api/dropbox/oauth/disconnect", { method: "POST", credentials: "include" });
      if (res.ok) {
        toast({ title: "✓ Dropboxを切断しました", description: "保存されていたトークンが削除されました。" });
        await fetchDropboxStatus();
      } else {
        toast({ title: "❌ 切断に失敗", description: `HTTP ${res.status}`, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "❌ 切断エラー", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setDropboxConnecting(false);
    }
  }, [fetchDropboxStatus, toast]);

  useEffect(() => {
    const fetchEditingStatus = () => {
      fetch("/api/editing/status").then(r => r.json()).then(setEditingStatus).catch(() => {});
    };
    fetchEditingStatus();
    const interval = setInterval(fetchEditingStatus, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    syncService.autoLogin().then(u => {
      if (u) {
        syncService.autoSyncOnOpen((result) => {
          if (result.added > 0 || result.updated > 0) {
            loadProjects();
          }
        });
        syncService.startAutoSync(() => {
          loadProjects();
        });
      }
    });
    return () => {
      syncService.stopAutoSync();
    };
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const list = await storage.getProjects();
      setProjects(list);
      const names = list.map(p => p.name);
      fetchReadings(names).then(r => setReadingsMap({ ...r }));
      const status: Record<string, boolean> = {};
      await Promise.all(list.map(async (p) => {
        try {
          const lyrics = await storage.getLyricLines(p.id);
          const contentLines = lyrics.filter(l => l.text && l.text.trim().length > 0);
          const audioTracks = await storage.getAudioTracks(p.id);
          const hasAudio = audioTracks.length > 0;
          const hasLyrics = contentLines.length > 0;
          const allTimed = hasLyrics && contentLines.every(l => l.startTime != null);
          status[p.id] = hasAudio && hasLyrics && allTimed;
        } catch {
          status[p.id] = false;
        }
      }));
      setTimingStatus(status);
    } catch {
      toast({ title: "プロジェクトの読み込みに失敗しました", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const PRESET_LABELS: Record<string, string> = {
    sakurazaka: "櫻坂46",
    hinatazaka: "日向坂46",
    other: "OTHER",
  };

  const importTelopFile = useCallback(async (file: File, targetPreset?: string) => {
    setImporting(true);
    try {
      const text = await file.text();
      const telopData = JSON.parse(text);
      if (!telopData || !telopData.project || !telopData.lyrics) {
        throw new Error("Invalid .telop file");
      }

      const filePreset = telopData.project.preset ?? "other";

      if (targetPreset && filePreset !== targetPreset) {
        const fileLabel = PRESET_LABELS[filePreset] || filePreset;
        const targetLabel = PRESET_LABELS[targetPreset] || targetPreset;
        const ok = window.confirm(
          `このファイルは「${fileLabel}」のプロジェクトですが、「${targetLabel}」に読み込みますか？`
        );
        if (!ok) {
          setImporting(false);
          return;
        }
      }

      const usePreset = targetPreset || filePreset;
      const applyDefaults = targetPreset && filePreset !== targetPreset;
      const defaults = applyDefaults ? (PRESET_DEFAULTS[usePreset] || {}) : {};

      const projectData: Partial<Project> & { name: string } = {
        name: telopData.project.name || "Imported Project",
        fontSize: defaults.fontSize ?? telopData.project.fontSize,
        fontFamily: defaults.fontFamily ?? telopData.project.fontFamily,
        fontColor: defaults.fontColor ?? telopData.project.fontColor,
        strokeColor: defaults.strokeColor ?? telopData.project.strokeColor,
        strokeWidth: defaults.strokeWidth ?? telopData.project.strokeWidth,
        strokeBlur: defaults.strokeBlur ?? telopData.project.strokeBlur ?? 0,
        textAlign: defaults.textAlign ?? telopData.project.textAlign,
        textX: defaults.textX ?? telopData.project.textX,
        textY: defaults.textY ?? telopData.project.textY,
        outputWidth: telopData.project.outputWidth,
        outputHeight: telopData.project.outputHeight,
        songTitle: telopData.project.songTitle,
        lyricsCredit: telopData.project.lyricsCredit,
        musicCredit: telopData.project.musicCredit,
        arrangementCredit: telopData.project.arrangementCredit,
        motifColor: telopData.project.motifColor,
        audioDuration: telopData.project.audioDuration,
        audioTrimStart: telopData.project.audioTrimStart ?? 0,
        detectedBpm: telopData.project.detectedBpm ?? null,
        bpmGridOffset: telopData.project.bpmGridOffset ?? 0,
        creditInTime: telopData.project.creditInTime ?? null,
        creditOutTime: telopData.project.creditOutTime ?? null,
        creditAnimDuration: telopData.project.creditAnimDuration ?? null,
        creditTitleFontSize: telopData.project.creditTitleFontSize ?? 80,
        creditLyricsFontSize: telopData.project.creditLyricsFontSize ?? 36,
        creditMusicFontSize: telopData.project.creditMusicFontSize ?? 36,
        creditArrangementFontSize: telopData.project.creditArrangementFontSize ?? 36,
        creditMembersFontSize: telopData.project.creditMembersFontSize ?? 36,
        creditRightTitleFontSize: telopData.project.creditRightTitleFontSize ?? 56,
        creditWipeStartMs: telopData.project.creditWipeStartMs ?? null,
        creditRightTitle: telopData.project.creditRightTitle ?? null,
        creditLineY: defaults.creditLineY ?? telopData.project.creditLineY,
        preset: usePreset,
      };

      const newProject = await storage.createProject(projectData);

      if (telopData.audio) {
        const binaryStr = atob(telopData.audio);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: "audio/mpeg" });
        // Match project.tsx:4330 — prefer the originally-exported audio file
        // name, fall back to songTitle, then finally to a placeholder.
        // DO NOT use "imported_audio.mp3" hard-coded: that placeholder name
        // is what used to strand the Dropbox auto-link forever because the
        // re-link search has nothing real to look for.
        const importedAudioName =
          (telopData.audioFileName || telopData.project?.audioFileName || telopData.project?.songTitle || telopData.project?.name || "imported_audio")
            .replace(/\.[^.]+$/i, "") + ".mp3";
        const trackLabel = importedAudioName.replace(/\.mp3$/i, "");
        const track = await storage.saveAudioTrack(newProject.id, blob, importedAudioName, trackLabel, "audio/mpeg");
        await storage.updateProject(newProject.id, { audioFileName: importedAudioName, activeAudioTrackId: track.id });
      }

      if (telopData.lyrics && telopData.lyrics.length > 0) {
        const sortedLyrics = [...telopData.lyrics].sort(
          (a: any, b: any) => (a.lineIndex ?? 0) - (b.lineIndex ?? 0)
        );
        const linesForInsert = sortedLyrics.map((l: any, i: number) => ({
          text: String(l.text || ""),
          lineIndex: i,
        }));
        const savedLines = await storage.setLyricLines(newProject.id, linesForInsert);

        const timingUpdates: { id: string; startTime: number | null; endTime: number | null }[] = [];
        for (let i = 0; i < sortedLyrics.length; i++) {
          const src = sortedLyrics[i];
          if (src.startTime != null || src.endTime != null) {
            const saved = savedLines[i];
            if (saved) {
              timingUpdates.push({
                id: saved.id,
                startTime: typeof src.startTime === "number" ? src.startTime : null,
                endTime: typeof src.endTime === "number" ? src.endTime : null,
              });
            }
          }
        }

        if (timingUpdates.length > 0) {
          await storage.updateLyricTimings(timingUpdates);
        }
      }

      toast({ title: `「${newProject.name}」を読み込みました` });
      await loadProjects();
      // Make sure the imported project is pushed to the server right away.
      syncService.immediatePush(newProject.id);
    } catch {
      toast({ title: ".telopファイルの読み込みに失敗しました", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }, [navigate, toast]);

  // Bulk import: drop / select many .telop files at once for a target column.
  // Non-.telop files are skipped silently. Files whose preset does not match the
  // target are confirmed once as a batch (not per-file), to keep the UX snappy.
  const importTelopFiles = useCallback(async (files: File[] | FileList, targetPreset?: string) => {
    const all = Array.from(files);
    const telops = all.filter(f => f.name.toLowerCase().endsWith(".telop"));
    if (telops.length === 0) {
      toast({ title: ".telopファイルのみインポートできます", variant: "destructive" });
      return;
    }

    // If a target column is specified, check whether any file needs a preset-change confirmation.
    // If so, ask ONCE for the whole batch.
    let forceTarget = false;
    if (targetPreset) {
      const mismatchedFiles: File[] = [];
      for (const f of telops) {
        try {
          const text = await f.text();
          const data = JSON.parse(text);
          const filePreset = data?.project?.preset ?? "other";
          if (filePreset !== targetPreset) mismatchedFiles.push(f);
        } catch {
          // malformed file — will be caught individually below
        }
      }
      if (mismatchedFiles.length > 0) {
        const targetLabel = PRESET_LABELS[targetPreset] || targetPreset;
        const ok = window.confirm(
          `${mismatchedFiles.length}件のファイルは別プリセットのプロジェクトですが、\nすべて「${targetLabel}」として読み込みますか？`
        );
        if (!ok) return;
        forceTarget = true;
      }
    }

    setImporting(true);
    let imported = 0;
    let failed = 0;
    const importedIds: string[] = [];
    try {
      for (const f of telops) {
        try {
          const text = await f.text();
          const telopData = JSON.parse(text);
          if (!telopData?.project || !telopData?.lyrics) throw new Error("Invalid .telop file");

          const filePreset = telopData.project.preset ?? "other";
          const usePreset = targetPreset || filePreset;
          const applyDefaults = !!targetPreset && filePreset !== targetPreset && forceTarget;
          const defaults = applyDefaults ? (PRESET_DEFAULTS[usePreset] || {}) : {};

          const projectData: Partial<Project> & { name: string } = {
            name: telopData.project.name || "Imported Project",
            fontSize: defaults.fontSize ?? telopData.project.fontSize,
            fontFamily: defaults.fontFamily ?? telopData.project.fontFamily,
            fontColor: defaults.fontColor ?? telopData.project.fontColor,
            strokeColor: defaults.strokeColor ?? telopData.project.strokeColor,
            strokeWidth: defaults.strokeWidth ?? telopData.project.strokeWidth,
            strokeBlur: defaults.strokeBlur ?? telopData.project.strokeBlur ?? 0,
            textAlign: defaults.textAlign ?? telopData.project.textAlign,
            textX: defaults.textX ?? telopData.project.textX,
            textY: defaults.textY ?? telopData.project.textY,
            outputWidth: telopData.project.outputWidth,
            outputHeight: telopData.project.outputHeight,
            songTitle: telopData.project.songTitle,
            lyricsCredit: telopData.project.lyricsCredit,
            musicCredit: telopData.project.musicCredit,
            arrangementCredit: telopData.project.arrangementCredit,
            motifColor: telopData.project.motifColor,
            audioDuration: telopData.project.audioDuration,
            audioTrimStart: telopData.project.audioTrimStart ?? 0,
            detectedBpm: telopData.project.detectedBpm ?? null,
            bpmGridOffset: telopData.project.bpmGridOffset ?? 0,
            creditInTime: telopData.project.creditInTime ?? null,
            creditOutTime: telopData.project.creditOutTime ?? null,
            creditAnimDuration: telopData.project.creditAnimDuration ?? null,
            creditTitleFontSize: telopData.project.creditTitleFontSize ?? 80,
            creditLyricsFontSize: telopData.project.creditLyricsFontSize ?? 36,
            creditMusicFontSize: telopData.project.creditMusicFontSize ?? 36,
            creditArrangementFontSize: telopData.project.creditArrangementFontSize ?? 36,
            creditMembersFontSize: telopData.project.creditMembersFontSize ?? 36,
            creditRightTitleFontSize: telopData.project.creditRightTitleFontSize ?? 56,
            creditWipeStartMs: telopData.project.creditWipeStartMs ?? null,
            creditRightTitle: telopData.project.creditRightTitle ?? null,
            creditLineY: defaults.creditLineY ?? telopData.project.creditLineY,
            preset: usePreset,
          };

          const newProject = await storage.createProject(projectData);

          if (telopData.audio) {
            const binaryStr = atob(telopData.audio);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            const blob = new Blob([bytes], { type: "audio/mpeg" });
            // Same smart-naming as the single-file importer above and
            // project.tsx:4330. Never use "imported_audio.mp3" hard-coded.
            const importedAudioName =
              (telopData.audioFileName || telopData.project?.audioFileName || telopData.project?.songTitle || telopData.project?.name || "imported_audio")
                .replace(/\.[^.]+$/i, "") + ".mp3";
            const trackLabel = importedAudioName.replace(/\.mp3$/i, "");
            const track = await storage.saveAudioTrack(newProject.id, blob, importedAudioName, trackLabel, "audio/mpeg");
            await storage.updateProject(newProject.id, { audioFileName: importedAudioName, activeAudioTrackId: track.id });
          }

          if (telopData.lyrics && telopData.lyrics.length > 0) {
            const sortedLyrics = [...telopData.lyrics].sort(
              (a: any, b: any) => (a.lineIndex ?? 0) - (b.lineIndex ?? 0)
            );
            const linesForInsert = sortedLyrics.map((l: any, i: number) => ({
              text: String(l.text || ""),
              lineIndex: i,
            }));
            const savedLines = await storage.setLyricLines(newProject.id, linesForInsert);

            const timingUpdates: { id: string; startTime: number | null; endTime: number | null }[] = [];
            for (let i = 0; i < sortedLyrics.length; i++) {
              const src = sortedLyrics[i];
              if (src.startTime != null || src.endTime != null) {
                const saved = savedLines[i];
                if (saved) {
                  timingUpdates.push({
                    id: saved.id,
                    startTime: typeof src.startTime === "number" ? src.startTime : null,
                    endTime: typeof src.endTime === "number" ? src.endTime : null,
                  });
                }
              }
            }
            if (timingUpdates.length > 0) {
              await storage.updateLyricTimings(timingUpdates);
            }
          }
          importedIds.push(newProject.id);
          imported++;
        } catch {
          failed++;
        }
      }
      if (imported > 0 && failed === 0) {
        toast({ title: `${imported}件のプロジェクトを読み込みました` });
      } else if (imported > 0 && failed > 0) {
        toast({ title: `${imported}件読み込み完了・${failed}件失敗`, variant: "destructive" });
      } else {
        toast({ title: ".telopファイルの読み込みに失敗しました", variant: "destructive" });
      }
      await loadProjects();
      // Push every imported project to the server so teammates can see them.
      for (const pid of importedIds) {
        syncService.immediatePush(pid);
      }
    } finally {
      setImporting(false);
    }
  }, [loadProjects, toast]);

  const createProject = useCallback(async (name: string, preset: string) => {
    setCreating(true);
    try {
      const defaults = PRESET_DEFAULTS[preset] || {};
      const project = await storage.createProject({ name, preset, ...defaults });
      const snapshot = await storage.getFullProjectSnapshot(project.id);
      setDialogOpen(false);
      setColumnDialogPreset(null);
      setNewName("");
      setNewPreset("other");
      await loadProjects();
      // Push the new project to the server immediately so teammates can see it
      // without having to open the editor first.
      syncService.immediatePush(project.id);
      if (snapshot) {
        pushUndo({
          description: `作成: ${name}`,
          undo: async () => {
            await storage.deleteProject(project.id);
            setProjects(prev => prev.filter(p => p.id !== project.id));
          },
          redo: async () => {
            await storage.restoreFullProjectSnapshot(snapshot);
            setProjects(prev => [...prev, snapshot.project as any]);
          },
        });
      }
    } catch {
      toast({ title: "プロジェクト作成に失敗しました", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }, [navigate, toast, pushUndo]);

  const deleteProject = useCallback(async (id: string) => {
    try {
      const snapshot = await storage.getFullProjectSnapshot(id);
      const deletedProject = projects.find(p => p.id === id);
      const folderRefs = folders.filter(f => f.projectIds.includes(id)).map(f => f.id);

      const tracks = await storage.getAudioTracks(id);
      const preset = deletedProject?.preset || "other";
      for (const track of tracks) {
        const resolvedPath = track.dropboxPath ||
          `/Telop音源/${preset === "sakurazaka" ? "SAKURAZAKA" : preset === "hinatazaka" ? "HINATAZAKA" : "OTHER"}/${track.fileName}`;
        const otherCount = await storage.countTracksWithDropboxPath(resolvedPath, track.id);
        if (otherCount === 0) {
          try {
            await fetch("/api/dropbox/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dropboxPath: resolvedPath }),
            });
          } catch {}
        }
      }

      await storage.deleteProject(id);
      try {
        await fetch(`/api/sync/projects/${id}`, { method: "DELETE" });
      } catch {}
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setFolders((prev) => prev.map(f => ({
        ...f,
        projectIds: f.projectIds.filter(pid => pid !== id),
      })));
      if (snapshot && deletedProject) {
        pushUndo({
          description: `削除: ${deletedProject.name}`,
          undo: async () => {
            await storage.restoreFullProjectSnapshot(snapshot);
            setProjects(prev => [...prev, deletedProject]);
            if (folderRefs.length > 0) {
              setFolders(prev => prev.map(f => folderRefs.includes(f.id) ? { ...f, projectIds: [...f.projectIds, id] } : f));
            }
          },
          redo: async () => {
            await storage.deleteProject(id);
            try { await fetch(`/api/sync/projects/${id}`, { method: "DELETE" }); } catch {}
            setProjects(prev => prev.filter(p => p.id !== id));
            setFolders(prev => prev.map(f => ({ ...f, projectIds: f.projectIds.filter(pid => pid !== id) })));
          },
        });
      }
    } catch {
      toast({ title: "削除に失敗しました", variant: "destructive" });
    }
  }, [toast, projects, folders, pushUndo]);

  const startRename = useCallback((project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(project.id);
    setRenameValue(project.name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    const oldName = projects.find(p => p.id === renamingId)?.name || "";
    const newNameVal = renameValue.trim();
    const id = renamingId;
    try {
      await storage.updateProject(id, { name: newNameVal });
      setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name: newNameVal } : p));
      syncService.immediatePush(id);
      pushUndo({
        description: `名前変更: ${oldName} → ${newNameVal}`,
        undo: async () => {
          await storage.updateProject(id, { name: oldName });
          setProjects(prev => prev.map(p => p.id === id ? { ...p, name: oldName } : p));
          syncService.immediatePush(id);
        },
        redo: async () => {
          await storage.updateProject(id, { name: newNameVal });
          setProjects(prev => prev.map(p => p.id === id ? { ...p, name: newNameVal } : p));
          syncService.immediatePush(id);
        },
      });
    } catch {
      toast({ title: "名前の変更に失敗しました", variant: "destructive" });
    }
    setRenamingId(null);
  }, [renamingId, renameValue, toast, projects, pushUndo]);

  const duplicateProject = useCallback(async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const newProject = await storage.duplicateProject(project.id, project.name + " (コピー)");
      const dupSnapshot = await storage.getFullProjectSnapshot(newProject.id);
      setProjects((prev) => [...prev, newProject]);
      toast({ title: `「${newProject.name}」を作成しました` });
      // Push the duplicated project so teammates can see it.
      syncService.immediatePush(newProject.id);
      if (dupSnapshot) {
        pushUndo({
          description: `複製: ${newProject.name}`,
          undo: async () => {
            await storage.deleteProject(newProject.id);
            setProjects(prev => prev.filter(p => p.id !== newProject.id));
          },
          redo: async () => {
            await storage.restoreFullProjectSnapshot(dupSnapshot);
            setProjects(prev => [...prev, dupSnapshot.project as any]);
          },
        });
      }
    } catch (err: any) {
      toast({ title: "コピーに失敗しました", description: err.message, variant: "destructive" });
    }
  }, [toast, pushUndo]);

  const createFolder = useCallback((name: string, preset: string) => {
    const folder: ConcertFolder = {
      id: crypto.randomUUID(),
      name,
      preset,
      projectIds: [],
      collapsed: false,
      createdAt: new Date().toISOString(),
    };
    setFolders(prev => [...prev, folder]);
    setFolderDialogPreset(null);
    setNewFolderName("");
    toast({ title: `フォルダ「${name}」を作成しました` });
  }, [toast]);

  const deleteFolder = useCallback((folderId: string) => {
    const deleted = folders.find(f => f.id === folderId);
    setFolders(prev => prev.filter(f => f.id !== folderId));
    if (deleted) {
      pushUndo({
        description: `フォルダ削除: ${deleted.name}`,
        undo: () => { setFolders(prev => [...prev, deleted]); },
        redo: () => { setFolders(prev => prev.filter(f => f.id !== folderId)); },
      });
    }
  }, [folders, pushUndo]);

  const toggleFolderCollapse = useCallback((folderId: string) => {
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, collapsed: !f.collapsed } : f));
  }, []);

  const addProjectToFolder = useCallback((folderId: string, projectId: string) => {
    const folder = folders.find(f => f.id === folderId);
    if (folder?.projectIds.includes(projectId)) return;
    setFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f;
      if (f.projectIds.includes(projectId)) return f;
      return { ...f, projectIds: [...f.projectIds, projectId] };
    }));
    pushUndo({
      description: `フォルダ追加`,
      undo: () => { setFolders(prev => prev.map(f => f.id === folderId ? { ...f, projectIds: f.projectIds.filter(pid => pid !== projectId) } : f)); },
      redo: () => { setFolders(prev => prev.map(f => f.id === folderId && !f.projectIds.includes(projectId) ? { ...f, projectIds: [...f.projectIds, projectId] } : f)); },
    });
  }, [folders, pushUndo]);

  const removeProjectFromFolder = useCallback((folderId: string, projectId: string) => {
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, projectIds: f.projectIds.filter(pid => pid !== projectId) } : f
    ));
    pushUndo({
      description: `フォルダから除外`,
      undo: () => { setFolders(prev => prev.map(f => f.id === folderId ? { ...f, projectIds: [...f.projectIds, projectId] } : f)); },
      redo: () => { setFolders(prev => prev.map(f => f.id === folderId ? { ...f, projectIds: f.projectIds.filter(pid => pid !== projectId) } : f)); },
    });
  }, [pushUndo]);

  const startRenameFolder = useCallback((folder: ConcertFolder, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingFolderId(folder.id);
    setRenameFolderValue(folder.name);
    setTimeout(() => renameFolderInputRef.current?.select(), 0);
  }, []);

  const commitRenameFolder = useCallback(() => {
    if (!renamingFolderId || !renameFolderValue.trim()) {
      setRenamingFolderId(null);
      return;
    }
    const oldName = folders.find(f => f.id === renamingFolderId)?.name || "";
    const newNameVal = renameFolderValue.trim();
    const id = renamingFolderId;
    setFolders(prev => prev.map(f =>
      f.id === id ? { ...f, name: newNameVal } : f
    ));
    pushUndo({
      description: `フォルダ名変更: ${oldName} → ${newNameVal}`,
      undo: () => { setFolders(prev => prev.map(f => f.id === id ? { ...f, name: oldName } : f)); },
      redo: () => { setFolders(prev => prev.map(f => f.id === id ? { ...f, name: newNameVal } : f)); },
    });
    setRenamingFolderId(null);
  }, [renamingFolderId, renameFolderValue, folders, pushUndo]);

  const sortProjects = useCallback((list: Project[]): Project[] => {
    const sorted = [...list];
    if (sortMode === "name") {
      sorted.sort((a, b) => {
        const ra = readingsMap[a.name] || a.name;
        const rb = readingsMap[b.name] || b.name;
        return ra.localeCompare(rb, "ja");
      });
    } else {
      sorted.sort((a, b) => {
        const da = new Date(b.createdAt || "").getTime();
        const db_ = new Date(a.createdAt || "").getTime();
        return da - db_;
      });
    }
    return sorted;
  }, [sortMode, readingsMap]);

  useEffect(() => {
    if (projects.length === 0) return;
    const projectIdSet = new Set(projects.map(p => p.id));
    let changed = false;
    const cleaned = folders.map(f => {
      const filtered = f.projectIds.filter(pid => projectIdSet.has(pid));
      if (filtered.length !== f.projectIds.length) { changed = true; return { ...f, projectIds: filtered }; }
      return f;
    });
    if (changed) setFolders(cleaned);
  }, [projects]);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextInput = target.tagName === "TEXTAREA" || target.tagName === "SELECT" ||
        (target.tagName === "INPUT" && !["range", "checkbox", "radio", "button"].includes((target as HTMLInputElement).type)) ||
        !!target.closest("[contenteditable]");
      if (isTextInput) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const desc = await undo();
        if (desc) toast({ title: `元に戻しました: ${desc}` });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        const desc = await redo();
        if (desc) toast({ title: `やり直しました: ${desc}` });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, toast]);

  const groupedProjects = COLUMNS.map((col) => {
    const colProjects = projects.filter((p) => {
      const preset = p.preset || "other";
      if (col.key === "other") {
        return preset !== "sakurazaka" && preset !== "hinatazaka";
      }
      return preset === col.key;
    });
    const colFolders = folders.filter(f => f.preset === col.key);
    return {
      ...col,
      projects: colProjects,
      folders: colFolders,
      allProjectsSorted: sortProjects(colProjects),
    };
  });

  const renderProjectRow = (project: Project, col: typeof COLUMNS[number], idx: number, inFolder?: { folderId: string }, indexLabel?: string | null) => (
    <div
      key={project.id}
      className="flex items-center px-1 rounded hover-elevate cursor-pointer group transition-colors"
      style={{ backgroundColor: TS_DESIGN.surface, borderLeft: `2px solid transparent`, height: 26 }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", project.id);
        e.dataTransfer.effectAllowed = "move";
        setDragProjectId(project.id);
      }}
      onDragEnd={() => setDragProjectId(null)}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderLeftColor = col.color; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent"; }}
      onClick={() => navigate(`/project/${project.id}`)}
      data-testid={`card-project-${project.id}`}
    >
      {indexLabel !== undefined && (
        <span
          className="shrink-0 text-center rounded font-bold mr-1.5"
          style={{
            color: indexLabel ? `color-mix(in srgb, ${col.color} 70%, white)` : "transparent",
            backgroundColor: indexLabel ? TS_DESIGN.bg2 : "transparent",
            width: 18,
            fontSize: 9,
            lineHeight: "16px",
          }}
        >{indexLabel || ""}</span>
      )}
      <div className="min-w-0 truncate" style={{ flex: "1 1 0" }}>
        {renamingId === project.id ? (
          <input
            ref={renameInputRef}
            className="font-medium text-[11px] bg-transparent border-b outline-none w-full text-foreground"
            style={{ borderColor: col.color }}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenamingId(null);
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid={`input-rename-project-${project.id}`}
          />
        ) : (
          <span
            className="font-medium text-[11px] truncate block leading-tight"
            style={{ color: timingStatus[project.id] ? TS_DESIGN.text : TS_DESIGN.text2 }}
            data-testid={`text-project-name-${project.id}`}
          >
            {project.name}
          </span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-0.5">
        {inFolder && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 w-5 h-5 invisible group-hover:visible"
            onClick={(e) => {
              e.stopPropagation();
              removeProjectFromFolder(inFolder.folderId, project.id);
            }}
            title="フォルダから外す"
          >
            <FolderOpen className="w-2.5 h-2.5" style={{ color: TS_DESIGN.text2 }} />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0 w-5 h-5 invisible group-hover:visible"
          onClick={(e) => startRename(project, e)}
          data-testid={`button-rename-project-${project.id}`}
          title="名前を変更"
        >
          <Pencil className="w-2.5 h-2.5" style={{ color: TS_DESIGN.text2 }} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0 w-5 h-5 invisible group-hover:visible"
          onClick={(e) => duplicateProject(project, e)}
          data-testid={`button-copy-project-${project.id}`}
          title="コピーを作成"
        >
          <Copy className="w-2.5 h-2.5" style={{ color: TS_DESIGN.text2 }} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0 w-5 h-5 invisible group-hover:visible"
          onClick={(e) => {
            e.stopPropagation();
            deleteProject(project.id);
          }}
          data-testid={`button-delete-project-${project.id}`}
          title="削除"
        >
          <Trash2 className="w-2.5 h-2.5 text-destructive" />
        </Button>
      </div>
      {editingStatus[project.id]?.editors?.length > 0 && (
        <span className="shrink-0 ml-1 flex items-center gap-0.5" data-testid={`text-editing-${project.id}`}>
          <span className="text-[7px] font-bold tracking-wider animate-pulse" style={{ color: TS_DESIGN.accent }}>EDIT</span>
          <span className="text-[7px] font-medium truncate max-w-[60px]" style={{ color: TS_DESIGN.accent2 }}>{editingStatus[project.id].editors.join(", ")}</span>
        </span>
      )}
      <span className="text-[8px] font-mono shrink-0 w-10 text-right ml-1 invisible group-hover:visible" style={{ color: TS_DESIGN.text3 }}>
        {project.createdAt ? new Date(project.createdAt).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }) : ""}
      </span>
    </div>
  );

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        background: TS_DESIGN.heroRadial,
        color: TS_DESIGN.text,
        fontFamily: '"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif',
      }}
    >
      <div className="max-w-[1400px] w-full mx-auto px-3 sm:px-6 pt-6 sm:pt-8 pb-2 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-8">
          {/* Brand block — same logo box + wordmark as the login screen */}
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 38,
                height: 38,
                background: TS_DESIGN.accent,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: '"Helvetica Neue","Hiragino Sans",sans-serif',
                fontWeight: 900,
                fontSize: 22,
                color: "#262624",
                letterSpacing: "-0.02em",
                boxShadow: `0 0 16px ${TS_DESIGN.accentGlow}`,
              }}
            >
              T
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <h1
                style={{
                  fontFamily: '"Helvetica Neue","Hiragino Sans",sans-serif',
                  fontWeight: 300,
                  letterSpacing: "0.03em",
                  fontSize: 18,
                  color: TS_DESIGN.text,
                  lineHeight: 1,
                  margin: 0,
                }}
                data-testid="text-app-title"
              >
                <b style={{ fontWeight: 800, color: TS_DESIGN.accent }}>TELOP</b> STUDIO
              </h1>
              <p
                style={{
                  fontSize: 9,
                  color: TS_DESIGN.text3,
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  margin: 0,
                }}
              >
                Lyric Subtitle Creator
              </p>
            </div>
          </div>
          <input
            ref={telopInputRef}
            type="file"
            accept=".telop"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) importTelopFiles(files);
              e.target.value = "";
            }}
            data-testid="input-telop-file"
          />
          <input
            ref={columnTelopInputRef}
            type="file"
            accept=".telop"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              const target = columnImportTargetRef.current || undefined;
              if (files && files.length > 0) importTelopFiles(files, target);
              columnImportTargetRef.current = null;
              e.target.value = "";
            }}
            data-testid="input-column-telop-file"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-0.5 mr-2">
              <Button
                size="icon"
                variant="ghost"
                className="w-7 h-7"
                disabled={!canUndo}
                onClick={async () => { const d = await undo(); if (d) toast({ title: `元に戻しました: ${d}` }); }}
                title={undoDescription ? `元に戻す: ${undoDescription}` : "元に戻す (Ctrl+Z)"}
                data-testid="button-undo"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="w-7 h-7"
                disabled={!canRedo}
                onClick={async () => { const d = await redo(); if (d) toast({ title: `やり直しました: ${d}` }); }}
                title={redoDescription ? `やり直す: ${redoDescription}` : "やり直す (Ctrl+Shift+Z)"}
                data-testid="button-redo"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </Button>
            </div>
            {isOnline ? (
              <span className="text-[9px] font-mono flex items-center gap-1" style={{ color: TS_DESIGN.okGreen, letterSpacing: "0.15em" }}>
                <Cloud className="w-3 h-3" /> ONLINE
              </span>
            ) : (
              <span className="text-[9px] font-mono flex items-center gap-1" style={{ color: TS_DESIGN.errorRed, letterSpacing: "0.15em" }}>
                <CloudOff className="w-3 h-3" /> OFFLINE
              </span>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="w-7 h-7"
              onClick={() => setDropboxDialogOpen(true)}
              title="Dropbox接続設定"
              data-testid="button-dropbox-settings"
            >
              {dropboxStatus?.customConnected ? (
                <Link2 className="w-3.5 h-3.5" style={{ color: "hsl(210 80% 60%)" }} />
              ) : (
                <Unlink2 className="w-3.5 h-3.5" style={{ color: "hsl(0 50% 55%)" }} />
              )}
            </Button>
          </div>
        </div>

        <Dialog open={dropboxDialogOpen} onOpenChange={setDropboxDialogOpen}>
          <DialogContent style={{ borderColor: "hsl(210 60% 35%)", borderWidth: "1px", maxWidth: "420px" }}>
            <DialogHeader>
              <DialogTitle style={{ color: "hsl(210 80% 70%)" }}>Dropbox 接続設定</DialogTitle>
              <DialogDescription style={{ color: TS_DESIGN.text2 }}>
                永続接続（リフレッシュトークン方式）を使用すると、接続が切れません。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              {dropboxStatus?.customConfigured ? (
                <>
                  <div className="rounded-md p-3 text-sm" style={{ background: TS_DESIGN.surface, border: `1px solid ${TS_DESIGN.border}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px]" style={{ color: TS_DESIGN.text3 }}>接続方式</span>
                      <span className="font-mono text-[10px] font-bold" style={{ color: "hsl(210 80% 65%)" }}>永続トークン (推奨)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px]" style={{ color: TS_DESIGN.text3 }}>状態</span>
                      {dropboxStatus.customConnected ? (
                        <span className="font-mono text-[10px] font-bold" style={{ color: TS_DESIGN.okGreen }}>✓ 接続中 — 自動更新有効</span>
                      ) : (
                        <span className="font-mono text-[10px] font-bold" style={{ color: TS_DESIGN.errorRed }}>✗ 未接続 — 下のボタンで接続</span>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={openDropboxConnect}
                    disabled={dropboxConnecting}
                    style={{ background: "hsl(210 70% 45%)", color: "#fff" }}
                    data-testid="button-dropbox-connect"
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    {dropboxConnecting ? "接続中..." : dropboxStatus.customConnected ? "Dropboxを再接続" : "Dropboxに接続"}
                  </Button>
                  {dropboxStatus.customConnected && (
                    <Button
                      onClick={disconnectDropbox}
                      disabled={dropboxConnecting}
                      style={{ background: "hsl(0 60% 35%)", color: "#fff" }}
                      data-testid="button-dropbox-disconnect"
                    >
                      <Unlink2 className="w-4 h-4 mr-2" />
                      Dropboxを切断
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <div className="rounded-md p-3 text-sm" style={{ background: TS_DESIGN.surface, border: `1px solid ${TS_DESIGN.accent}66` }}>
                    <p className="text-[11px] mb-2" style={{ color: TS_DESIGN.accent2 }}>⚠ DROPBOX_APP_KEY が未設定</p>
                    <p className="text-[10px] leading-relaxed" style={{ color: TS_DESIGN.text2 }}>
                      永続接続を使用するには、Dropbox App Key と App Secret を環境変数に設定し、ここで接続してください。
                    </p>
                  </div>
                  <div className="text-[10px] leading-relaxed" style={{ color: TS_DESIGN.text2 }}>
                    <p className="font-bold mb-1" style={{ color: TS_DESIGN.text }}>設定手順：</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>dropbox.com/developers/apps でアプリを作成</li>
                      <li>Redirect URI に <code className="text-[9px]" style={{ color: "hsl(210 70% 65%)" }}>{window.location.origin}/api/dropbox/oauth/callback</code> を追加</li>
                      <li>DROPBOX_APP_KEY と DROPBOX_APP_SECRET を Secrets に設定</li>
                      <li>アプリを再デプロイ後、このダイアログで「接続」をクリック</li>
                    </ol>
                  </div>
                  <div className="rounded-md p-2 text-[10px] font-mono" style={{ background: TS_DESIGN.bg2, color: TS_DESIGN.text3 }}>
                    現在の状態: Dropbox 未設定 (環境変数を設定してデプロイしてください)
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={columnDialogPreset !== null} onOpenChange={(open) => { if (!open) { setColumnDialogPreset(null); setNewName(""); } }}>
          {(() => {
            const colInfo = COLUMNS.find(c => c.key === columnDialogPreset);
            const accentColor = colInfo?.color ?? TS_DESIGN.text2;
            return (
              <DialogContent style={{ borderColor: accentColor, borderWidth: "1px" }}>
                <DialogHeader>
                  <DialogTitle style={{ color: accentColor }}>NEW SONG</DialogTitle>
                  <DialogDescription>
                    <span style={{ color: accentColor, fontWeight: 600 }}>{colInfo?.label ?? ""}</span> に新規プロジェクトを作成
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newName.trim() && columnDialogPreset) {
                      createProject(newName.trim(), columnDialogPreset);
                      setColumnDialogPreset(null);
                    }
                  }}
                  className="flex flex-col gap-4 mt-2"
                >
                  <Input
                    placeholder="曲名を入力"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="focus-visible:ring-0 focus-visible:ring-offset-0"
                    style={{ borderColor: accentColor }}
                    data-testid="input-column-project-name"
                    autoFocus
                  />
                  <Button
                    type="submit"
                    disabled={!newName.trim() || creating}
                    style={{ backgroundColor: accentColor, color: "#fff" }}
                    data-testid="button-column-create-project"
                  >
                    作成
                  </Button>
                </form>
              </DialogContent>
            );
          })()}
        </Dialog>

        <Dialog open={folderDialogPreset !== null} onOpenChange={(open) => { if (!open) { setFolderDialogPreset(null); setNewFolderName(""); } }}>
          {(() => {
            const colInfo = COLUMNS.find(c => c.key === folderDialogPreset);
            const accentColor = colInfo?.color ?? TS_DESIGN.text2;
            return (
              <DialogContent style={{ borderColor: accentColor, borderWidth: "1px" }}>
                <DialogHeader>
                  <DialogTitle style={{ color: accentColor }}>NEW FOLDER</DialogTitle>
                  <DialogDescription>
                    コンサート/ライブ用のフォルダを作成
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newFolderName.trim() && folderDialogPreset) {
                      createFolder(newFolderName.trim(), folderDialogPreset);
                    }
                  }}
                  className="flex flex-col gap-4 mt-2"
                >
                  <Input
                    placeholder="フォルダ名（例: 3rd TOUR 2026）"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    className="focus-visible:ring-0 focus-visible:ring-offset-0"
                    style={{ borderColor: accentColor }}
                    data-testid="input-folder-name"
                    autoFocus
                  />
                  <Button
                    type="submit"
                    disabled={!newFolderName.trim()}
                    style={{ backgroundColor: accentColor, color: "#fff" }}
                    data-testid="button-create-folder"
                  >
                    作成
                  </Button>
                </form>
              </DialogContent>
            );
          })()}
        </Dialog>
      </div>

      <div className="flex-1 min-h-0 lg:overflow-hidden overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: `${TS_DESIGN.border} transparent` }}>
        <div className="max-w-[1400px] w-full mx-auto px-3 sm:px-6 pb-6 lg:h-full lg:overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:h-full lg:overflow-hidden" style={{ gridTemplateRows: "1fr" }} data-testid="project-columns">
          {groupedProjects.map((col) => (
            <div
              key={col.key}
              className="relative flex flex-col rounded-lg transition-colors lg:min-h-0 lg:overflow-hidden"
              style={{
                border: columnDragOver === col.key ? `2px dashed ${col.color}` : "2px dashed transparent",
                backgroundColor: columnDragOver === col.key ? `color-mix(in srgb, ${col.color} 8%, transparent)` : "transparent",
                padding: "4px",
              }}
              onDragEnter={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                columnDragCounters.current[col.key] = (columnDragCounters.current[col.key] || 0) + 1;
                setColumnDragOver(col.key);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                columnDragCounters.current[col.key] = (columnDragCounters.current[col.key] || 1) - 1;
                if (columnDragCounters.current[col.key] <= 0) {
                  columnDragCounters.current[col.key] = 0;
                  setColumnDragOver(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                columnDragCounters.current[col.key] = 0;
                setColumnDragOver(null);
                const files = e.dataTransfer.files;
                if (files.length === 0) return;
                importTelopFiles(files, col.key);
              }}
              data-testid={`column-drop-${col.key}`}
            >
              {columnDragOver === col.key && (
                <div
                  className="absolute inset-1 z-20 flex items-center justify-center rounded pointer-events-none"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${col.color} 22%, rgba(31,31,29,0.80))`,
                    backdropFilter: "blur(2px)",
                  }}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8" style={{ color: col.color }} />
                    <div className="text-sm font-bold tracking-wider" style={{ color: col.color }}>
                      {col.label} にインポート
                    </div>
                    <div className="text-[10px]" style={{ color: `color-mix(in srgb, ${col.color} 80%, ${TS_DESIGN.text})` }}>
                      ここで離す（複数OK）
                    </div>
                  </div>
                </div>
              )}
              <div className="mb-3 px-2 shrink-0">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <h2
                    className="font-bold tracking-[0.12em] truncate min-w-0"
                    style={{
                      color: col.color,
                      fontSize: 17,
                      fontFamily: '"Helvetica Neue","Hiragino Sans",sans-serif',
                    }}
                  >
                    {col.label}
                  </h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="font-mono px-1.5 py-0.5 rounded flex items-center gap-0.5 whitespace-nowrap"
                      style={{
                        fontSize: 9,
                        color: col.color,
                        backgroundColor: TS_DESIGN.surface,
                        border: `1px solid ${col.color}44`,
                        letterSpacing: "0.08em",
                      }}
                      onClick={() => setSortMode(sortMode === "name" ? "date" : "name")}
                      data-testid={`button-sort-toggle-${col.key}`}
                      title={sortMode === "name" ? "五十音順 → 作成日順" : "作成日順 → 五十音順"}
                    >
                      <ArrowUpDown className="w-2.5 h-2.5" />
                      {sortMode === "name" ? "あいう順" : "作成日順"}
                    </button>
                    <span className="text-[10px] font-mono" style={{ color: TS_DESIGN.text3 }}>
                      {col.projects.length}
                    </span>
                  </div>
                </div>
                <div className="h-px mb-2" style={{ backgroundColor: col.color, opacity: 0.4 }} />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-[11px] tracking-wider h-7 whitespace-nowrap"
                    style={{
                      borderColor: `color-mix(in srgb, ${col.color} 50%, ${TS_DESIGN.border})`,
                      color: `color-mix(in srgb, ${col.color} 70%, ${TS_DESIGN.text})`,
                      backgroundColor: `color-mix(in srgb, ${col.color} 8%, ${TS_DESIGN.surface})`,
                    }}
                    onClick={() => setColumnDialogPreset(col.key)}
                    data-testid={`button-new-song-${col.key}`}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    NEW SONG
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[11px] tracking-wider h-7"
                    title={`.telopファイルを${col.label}にインポート`}
                    style={{
                      borderColor: `color-mix(in srgb, ${col.color} 50%, ${TS_DESIGN.border})`,
                      color: `color-mix(in srgb, ${col.color} 70%, ${TS_DESIGN.text})`,
                      backgroundColor: `color-mix(in srgb, ${col.color} 8%, ${TS_DESIGN.surface})`,
                    }}
                    onClick={() => {
                      columnImportTargetRef.current = col.key;
                      columnTelopInputRef.current?.click();
                    }}
                    data-testid={`button-import-telop-${col.key}`}
                  >
                    <Upload className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[11px] tracking-wider h-7"
                    style={{
                      borderColor: `color-mix(in srgb, ${col.color} 50%, ${TS_DESIGN.border})`,
                      color: `color-mix(in srgb, ${col.color} 70%, ${TS_DESIGN.text})`,
                      backgroundColor: `color-mix(in srgb, ${col.color} 8%, ${TS_DESIGN.surface})`,
                    }}
                    onClick={() => setFolderDialogPreset(col.key)}
                    data-testid={`button-new-folder-${col.key}`}
                  >
                    <FolderPlus className="w-3 h-3" />
                  </Button>
                </div>
                <p className="text-[9px] mt-1.5 text-center tracking-wider" style={{ color: TS_DESIGN.text3 }}>
                  .telopをドロップ / <Upload className="w-2.5 h-2.5 inline" />でインポート
                </p>
              </div>

              {col.folders.length > 0 && (
                <div className="space-y-1 px-1 mb-2 shrink-0">
                  {col.folders.map(folder => {
                    const folderProjects = sortProjects(
                      folder.projectIds
                        .map(pid => projects.find(p => p.id === pid))
                        .filter((p): p is Project => !!p)
                    );
                    return (
                      <div
                        key={folder.id}
                        className="rounded-md overflow-hidden"
                        style={{
                          backgroundColor: folderDragOver === folder.id ? `color-mix(in srgb, ${col.color} 15%, ${TS_DESIGN.bg2})` : TS_DESIGN.bg2,
                          border: folderDragOver === folder.id ? `1px dashed ${col.color}` : `1px solid ${TS_DESIGN.border}`,
                        }}
                        onDragOver={(e) => {
                          if (!dragProjectId) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "move";
                          setFolderDragOver(folder.id);
                        }}
                        onDragEnter={(e) => {
                          if (!dragProjectId) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setFolderDragOver(folder.id);
                        }}
                        onDragLeave={(e) => {
                          e.stopPropagation();
                          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                            setFolderDragOver(null);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setFolderDragOver(null);
                          const projectId = e.dataTransfer.getData("text/plain");
                          if (projectId && dragProjectId) {
                            const draggedProject = projects.find(p => p.id === projectId);
                            const projectPreset = draggedProject?.preset || "other";
                            const effectivePreset = projectPreset === "sakurazaka" || projectPreset === "hinatazaka" ? projectPreset : "other";
                            if (effectivePreset !== folder.preset) {
                              toast({ title: "別カテゴリのプロジェクトはこのフォルダに追加できません", variant: "destructive" });
                            } else {
                              addProjectToFolder(folder.id, projectId);
                            }
                          }
                        }}
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer group/folder"
                          style={{ borderLeft: `3px solid ${col.color}`, backgroundColor: `color-mix(in srgb, ${col.color} 8%, ${TS_DESIGN.surface})` }}
                          onClick={() => toggleFolderCollapse(folder.id)}
                        >
                          {folder.collapsed ? (
                            <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: col.color }} />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: col.color }} />
                          )}
                          <FolderOpen className="w-4 h-4 shrink-0" style={{ color: col.color }} />
                          {renamingFolderId === folder.id ? (
                            <input
                              ref={renameFolderInputRef}
                              className="text-xs font-semibold bg-transparent border-b outline-none flex-1 text-foreground"
                              style={{ borderColor: col.color }}
                              value={renameFolderValue}
                              onChange={(e) => setRenameFolderValue(e.target.value)}
                              onBlur={commitRenameFolder}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRenameFolder();
                                if (e.key === "Escape") setRenamingFolderId(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`input-rename-folder-${folder.id}`}
                            />
                          ) : (
                            <span className="text-xs font-bold flex-1 truncate" style={{ color: col.color }}>
                              {folder.name}
                            </span>
                          )}
                          <span className="text-[9px] font-mono" style={{ color: TS_DESIGN.text3 }}>
                            {folderProjects.length}曲
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="shrink-0 w-6 h-6 invisible group-hover/folder:visible"
                            onClick={(e) => startRenameFolder(folder, e)}
                            title="フォルダ名変更"
                          >
                            <Pencil className="w-2.5 h-2.5" style={{ color: TS_DESIGN.text2 }} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="shrink-0 w-6 h-6 invisible group-hover/folder:visible"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteFolder(folder.id);
                            }}
                            title="フォルダ削除"
                          >
                            <Trash2 className="w-2.5 h-2.5 text-destructive" />
                          </Button>
                        </div>
                        {!folder.collapsed && folderProjects.length > 0 && (
                          <div className="space-y-0.5 pb-1">
                            {folderProjects.map((p, i) => renderProjectRow(p, col, i, { folderId: folder.id }))}
                          </div>
                        )}
                        {!folder.collapsed && folderProjects.length === 0 && (
                          <div className="px-4 py-3 text-center">
                            <p className="text-[9px]" style={{ color: TS_DESIGN.text3 }}>
                              曲をドラッグ&ドロップで追加
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {isLoading ? (
                <div className="space-y-0.5 px-1 shrink-0">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-7 rounded animate-pulse" style={{ backgroundColor: TS_DESIGN.surface }} />
                  ))}
                </div>
              ) : col.allProjectsSorted.length > 0 ? (
                <div
                  className="space-y-px px-1 flex-1 lg:min-h-0 lg:overflow-y-auto"
                  style={{ scrollbarWidth: "thin", scrollbarColor: `color-mix(in srgb, ${col.color} 40%, ${TS_DESIGN.border}) transparent` }}
                >
                  {(() => {
                    let lastLabel = "";
                    return col.allProjectsSorted.map((project, idx) => {
                      const label = sortMode === "name" ? getIndexLabel(project.name, readingsMap) : null;
                      const showLabel = label && label !== lastLabel;
                      if (label) lastLabel = label;
                      return renderProjectRow(project, col, idx, undefined, sortMode === "name" ? (showLabel ? label : null) : undefined);
                    });
                  })()}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center flex-1 rounded-md" style={{ backgroundColor: TS_DESIGN.bg2, border: `1px dashed ${TS_DESIGN.border}` }}>
                  <FolderOpen className="w-5 h-5 mb-2" style={{ color: TS_DESIGN.text3 }} />
                  <p className="text-[10px]" style={{ color: TS_DESIGN.text3 }}>
                    プロジェクトなし
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
        </div>
      </div>

      <footer className="shrink-0 py-2 px-4" style={{ borderTop: `1px solid ${TS_DESIGN.border}`, background: TS_DESIGN.bg2 }}>
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <span className="text-[9px] font-mono tracking-wider uppercase" style={{ color: TS_DESIGN.text3 }}>
            TELOP STUDIO
          </span>
          <span className="text-[9px] font-mono" style={{ color: TS_DESIGN.text3 }}>
            {projects.length} projects
          </span>
        </div>
      </footer>
    </div>
  );
}
