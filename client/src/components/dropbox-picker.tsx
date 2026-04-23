import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Cloud, Music, Loader2, FolderOpen, RefreshCw, Folder, ChevronLeft, FileText, Search, X } from "lucide-react";
import { fetchDropbox } from "@/lib/dropbox-auto-reconnect";

interface DropboxFile {
  name: string;
  path: string;
  size: number;
}

interface BrowseEntry {
  name: string;
  path: string;
  type: "folder" | "file";
  size: number;
}

interface DropboxPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (file: DropboxFile) => void;
  preset?: string;
}

// 初期表示は nrs チーム フォルダ(現場作業フォルダ)。その下に NEW TELOP / 歌詞テロップ
// など現在進行中の案件フォルダが並ぶ。team space ルートには過去アーカイブが大量に
// あるので、そこには戻るボタンで明示的に降りる方式。
const TEAM_SPACE_ROOT = "";
const NRS_TEAM_FOLDER = "/nrs チーム フォルダ";
const NEW_TELOP_ROOT = `${NRS_TEAM_FOLDER}/NEW TELOP`;
const TELOP_ROOT = `${NEW_TELOP_ROOT}/Telop音源`;

const shortcuts = [
  { key: "nrsTeam", label: "nrs チーム", path: NRS_TEAM_FOLDER },
  { key: "newTelop", label: "NEW TELOP", path: NEW_TELOP_ROOT },
  { key: "telop", label: "Telop音源", path: TELOP_ROOT },
  { key: "sakurazaka", label: "SAKURAZAKA", path: `${TELOP_ROOT}/SAKURAZAKA` },
  { key: "hinatazaka", label: "HINATAZAKA", path: `${TELOP_ROOT}/HINATAZAKA` },
  { key: "other", label: "OTHER", path: `${TELOP_ROOT}/OTHER` },
  { key: "teamSpaceRoot", label: "全体(アーカイブ含)", path: TEAM_SPACE_ROOT },
];

export function DropboxPicker({ open, onClose, onSelect, preset }: DropboxPickerProps) {
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(NRS_TEAM_FOLDER);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ name: string; path: string; size: number }[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const browse = useCallback(async (folderPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = folderPath ? `?path=${encodeURIComponent(folderPath)}` : "";
      const res = await fetchDropbox(`/api/dropbox/browse${query}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "フォルダの取得に失敗しました");
      }
      const data = await res.json();
      setEntries(data.entries || []);
      setCurrentPath(folderPath);
    } catch (err: any) {
      setError(err.message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults(null); return; }
    setSearchLoading(true);
    try {
      const res = await fetchDropbox(`/api/dropbox/search?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim()) { setSearchResults(null); return; }
    searchTimerRef.current = setTimeout(() => doSearch(value), 400);
  }, [doSearch]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open) {
      // 初期パス: /nrs チーム フォルダ(現場作業フォルダ)
      // 「全体(アーカイブ含)」ショートカットで team space ルートに降りられる
      setPathHistory([]);
      setCurrentPath(NRS_TEAM_FOLDER);
      setSearchQuery("");
      setSearchResults(null);
      browse(NRS_TEAM_FOLDER);
    }
  }, [open, browse]);

  const navigateToFolder = (folderPath: string) => {
    setPathHistory(prev => [...prev, currentPath]);
    browse(folderPath);
  };

  const navigateBack = () => {
    if (pathHistory.length === 0) return;
    const prev = pathHistory[pathHistory.length - 1];
    setPathHistory(h => h.slice(0, -1));
    browse(prev);
  };

  const jumpToShortcut = (path: string) => {
    setPathHistory([NRS_TEAM_FOLDER]);
    browse(path);
  };

  const activeShortcut = shortcuts.find(s => s.path === currentPath)?.key || null;
  const displayPath = !currentPath
    ? "/"
    : currentPath.startsWith(NRS_TEAM_FOLDER)
      ? (currentPath === NRS_TEAM_FOLDER ? "/" : currentPath.slice(NRS_TEAM_FOLDER.length))
      : currentPath;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-lg overflow-hidden"
        style={{ backgroundColor: "hsl(0 0% 8%)", border: "1px solid hsl(0 0% 18%)", color: "hsl(0 0% 90%)" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "hsl(0 0% 90%)" }}>
            <Cloud className="w-5 h-5 text-blue-400" />
            nrs Team Dropbox
          </DialogTitle>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "hsl(0 0% 40%)" }} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Dropbox内を検索..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && searchQuery) { e.stopPropagation(); clearSearch(); } }}
            className="w-full text-[13px] rounded pl-8 pr-8 py-1.5 outline-none"
            style={{ backgroundColor: "hsl(0 0% 12%)", border: "1px solid hsl(0 0% 20%)", color: "hsl(0 0% 85%)" }}
            data-testid="input-dropbox-search"
          />
          {searchQuery && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded"
              onClick={clearSearch}
              style={{ color: "hsl(0 0% 50%)" }}
              data-testid="button-dropbox-search-clear"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {searchResults === null && <div className="flex items-center gap-1 mb-0.5 min-w-0">
          <button
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs transition-colors shrink-0"
            style={{
              color: pathHistory.length === 0 ? "hsl(0 0% 25%)" : "hsl(210 70% 60%)",
              backgroundColor: pathHistory.length === 0 ? "transparent" : "hsl(210 50% 15%)",
              cursor: pathHistory.length === 0 ? "default" : "pointer",
            }}
            onClick={navigateBack}
            disabled={pathHistory.length === 0}
            data-testid="button-dropbox-back"
          >
            <ChevronLeft className="w-4 h-4" />
            戻る
          </button>
          <span className="text-[10px] truncate flex-1 min-w-0" style={{ color: "hsl(0 0% 40%)" }}>
            {displayPath}
          </span>
          <RefreshCw
            className={`w-3.5 h-3.5 cursor-pointer shrink-0 ${loading ? "animate-spin" : ""}`}
            style={{ color: "hsl(0 0% 40%)" }}
            onClick={() => browse(currentPath)}
            data-testid="button-dropbox-refresh"
          />
        </div>}

        {searchResults !== null ? (
          <div
            className="max-h-[28rem] overflow-y-auto rounded-md"
            style={{ border: "1px solid hsl(0 0% 15%)" }}
          >
            {searchLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                <span className="ml-2 text-sm" style={{ color: "hsl(0 0% 60%)" }}>検索中...</span>
              </div>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <div className="py-12 text-center">
                <Search className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(0 0% 35%)" }} />
                <p className="text-sm" style={{ color: "hsl(0 0% 50%)" }}>見つかりませんでした</p>
              </div>
            )}
            {!searchLoading && searchResults.length > 0 && (
              <div className="flex flex-col gap-[2px] p-1">
                {searchResults.map((file) => (
                  <button
                    key={file.path}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded transition-all overflow-hidden"
                    style={{ backgroundColor: "hsl(0 0% 11%)", minWidth: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = "hsl(0 0% 16%)"; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = "hsl(0 0% 11%)"; }}
                    onClick={() => onSelect({ name: file.name, path: file.path, size: file.size })}
                    data-testid={`dropbox-search-${file.name}`}
                  >
                    <div className="shrink-0" style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: "hsl(210 80% 55%)" }} />
                    <Music className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(210 70% 60%)" }} />
                    <div className="min-w-0 flex-1">
                      <span className="text-[13px] block truncate" style={{ color: "hsl(0 0% 82%)" }}>{file.name}</span>
                      <span className="text-[9px] block truncate" style={{ color: "hsl(0 0% 35%)" }}>{file.path.replace(TEAM_ROOT, "")}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
        <div
          className="max-h-[28rem] overflow-y-auto rounded-md"
          style={{ border: "1px solid hsl(0 0% 15%)" }}
        >
          {loading && (
            <div className="flex items-center justify-center py-12" data-testid="dropbox-loading">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              <span className="ml-2 text-sm" style={{ color: "hsl(0 0% 60%)" }}>読み込み中...</span>
            </div>
          )}

          {error && !loading && (
            <div className="p-4 text-center" data-testid="dropbox-error">
              <p className="text-sm text-red-400 mb-2">{error}</p>
              <Button size="sm" variant="outline" onClick={() => browse(currentPath)} data-testid="button-dropbox-retry">
                再試行
              </Button>
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="py-12 text-center" data-testid="dropbox-empty">
              <FolderOpen className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(0 0% 35%)" }} />
              <p className="text-sm" style={{ color: "hsl(0 0% 50%)" }}>空のフォルダです</p>
            </div>
          )}

          {!loading && !error && entries.length > 0 && (
            <div className="flex flex-col gap-[2px] p-1">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded transition-all group overflow-hidden"
                  style={{ backgroundColor: "hsl(0 0% 11%)", minWidth: 0 }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = "hsl(0 0% 16%)"; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = "hsl(0 0% 11%)"; }}
                  onClick={() => {
                    if (entry.type === "folder") {
                      navigateToFolder(entry.path);
                    } else {
                      onSelect({ name: entry.name, path: entry.path, size: entry.size });
                    }
                  }}
                  data-testid={`dropbox-entry-${entry.name}`}
                >
                  <div
                    className="shrink-0"
                    style={{ width: 3, height: 16, borderRadius: 2, backgroundColor: entry.type === "folder" ? "hsl(45 80% 50%)" : /\.(docx|xlsx|xls|pdf|txt|pptx|csv)$/i.test(entry.name) ? "hsl(140 50% 50%)" : "hsl(210 80% 55%)" }}
                  />
                  <div className="shrink-0" style={{ width: 14, height: 14 }}>
                    {entry.type === "folder" ? (
                      <Folder className="w-3.5 h-3.5" style={{ color: "hsl(45 70% 55%)" }} />
                    ) : /\.(docx|xlsx|xls|pdf|txt|pptx|csv)$/i.test(entry.name) ? (
                      <FileText className="w-3.5 h-3.5" style={{ color: "hsl(140 50% 55%)" }} />
                    ) : (
                      <Music className="w-3.5 h-3.5" style={{ color: "hsl(210 70% 60%)" }} />
                    )}
                  </div>
                  <span className="text-[13px] block truncate min-w-0" style={{ color: "hsl(0 0% 82%)" }}>{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        <div className="flex justify-end mt-2">
          <Button variant="ghost" onClick={onClose} className="text-xs" style={{ color: "hsl(0 0% 60%)" }} data-testid="button-dropbox-close">
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
