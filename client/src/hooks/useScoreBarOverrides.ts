// 譜割タブ BAR 列の手動編集（per-section）を管理するフック。
// localStorage キー：telop-score-bars-{projectId}
//
// データ形式：{ [sectionId]: string }
//   - 値は改行込みの 1 文字列（textarea の内容そのまま）
//   - override がない section は自動計算（tokenizeBars）で表示される
//
// 安全装置（DATA_SAFETY_RULES.md 準拠）：
//   - 既存の telop-score-v3 / telop-sections-v1 / telop-lyric-overrides-{id} は触らない
//   - このキーは新規。データ加工・マイグレーションなし

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { safeSetItem } from "@/lib/safeStorage";

export type ScoreBarOverrides = Record<string, string>;

export function useScoreBarOverrides(projectId: string | undefined) {
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<ScoreBarOverrides>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setOverrides({});
      setInitialized(false);
      return;
    }
    setInitialized(false);
    try {
      const raw = localStorage.getItem(`telop-score-bars-${projectId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setOverrides(parsed as ScoreBarOverrides);
        } else {
          setOverrides({});
        }
      } else {
        setOverrides({});
      }
    } catch {
      setOverrides({});
    }
    setInitialized(true);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !initialized) return;
    const handle = setTimeout(() => {
      safeSetItem(
        `telop-score-bars-${projectId}`,
        JSON.stringify(overrides),
        (msg) => toast({ title: msg, variant: "destructive" }),
        "譜割タブの BAR 編集",
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [overrides, projectId, initialized, toast]);

  const setBar = useCallback((sectionId: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [sectionId]: value }));
  }, []);

  return { barOverrides: overrides, setBar };
}
