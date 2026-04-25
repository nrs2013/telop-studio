// 譜割（SCORE）タブのデータ管理フック。
// localStorage キー `telop-score-v3-{projectId}` に紐づく state を一元管理。
//
// 安全装置（DATA_SAFETY_RULES.md 準拠）：
//   - データ加工なし／自動振り分けなし／マイグレーションなし
//   - 読み込み時の filter/map は防御的（型ガード）のみ。歌詞内容は変えない。
//   - 既存キーへの書き戻しは初期化完了後だけ（initialized フラグで保護）。
//   - 保存失敗は safeSetItem 経由で toast 通知。

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { safeSetItem } from "@/lib/safeStorage";

export type ScoreRow = { id: string; section: string; bars: string; lyric: string };

export function useScoreRows(projectId: string | undefined) {
  const { toast } = useToast();
  const [scoreRows, setScoreRows] = useState<ScoreRow[]>([]);
  const [scoreInitialized, setScoreInitialized] = useState(false);

  const buildEmptyScoreRows = useCallback((count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `init-${Date.now().toString(36)}-${i}`,
      section: "",
      bars: "",
      lyric: "",
    }));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setScoreRows([]);
      setScoreInitialized(false);
      return;
    }
    setScoreInitialized(false);
    try {
      const raw = localStorage.getItem(`telop-score-v3-${projectId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 既存データはそのまま使う（勝手に 100 行に padding しない）。
          // ユーザーが消した行は消えたまま。最低 1 行だけは残す（空のときも編集できるように）。
          const rows = parsed
            .filter((r: any) => r && typeof r.id === "string")
            .map((r: any) => ({
              id: String(r.id),
              section: typeof r.section === "string" ? r.section : "",
              bars: typeof r.bars === "string" ? r.bars : (typeof r.bars === "number" && Number.isFinite(r.bars) ? String(r.bars) : ""),
              lyric: typeof r.lyric === "string" ? r.lyric : "",
            }));
          setScoreRows(rows.length > 0 ? rows : buildEmptyScoreRows(1));
        } else {
          setScoreRows(buildEmptyScoreRows(100));
        }
      } else {
        // 新規プロジェクトのみ 100 行で開く
        setScoreRows(buildEmptyScoreRows(100));
      }
    } catch {
      setScoreRows(buildEmptyScoreRows(100));
    }
    setScoreInitialized(true);
  }, [projectId, buildEmptyScoreRows]);

  // 保存はデバウンス（タイプ毎に走ると重い）
  useEffect(() => {
    if (!projectId || !scoreInitialized) return;
    const handle = setTimeout(() => {
      safeSetItem(
        `telop-score-v3-${projectId}`,
        JSON.stringify(scoreRows),
        (msg) => toast({ title: msg, variant: "destructive" }),
        "譜割タブのデータ",
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [scoreRows, projectId, scoreInitialized, toast]);

  const updateScoreRow = useCallback((idx: number, patch: Partial<{ section: string; bars: string; lyric: string }>) => {
    setScoreRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }, []);

  return { scoreRows, setScoreRows, updateScoreRow };
}
