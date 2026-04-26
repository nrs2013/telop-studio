// 譜割タブ LYRIC 列の「全曲分の歌詞テキスト（1 つの長い文字列）」を管理するフック。
// localStorage キー：telop-score-fulltext-{projectId}
//
// per-section override（telop-lyric-overrides-{id}）とは別キー。新しい一括ペースト用。
//
// 安全装置（DATA_SAFETY_RULES.md 準拠）：
//   - 既存の telop-score-v3 / telop-sections-v1 / telop-lyric-overrides-{id} は触らない
//   - このキーは新規。データ加工・マイグレーションなし

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { safeSetItem } from "@/lib/safeStorage";

export function useScoreFullText(projectId: string | undefined) {
  const { toast } = useToast();
  // null = まだ未ロード or 未保存（フォールバックを使う）
  // string = ユーザーが編集済み（空文字列でも編集された扱い）
  const [fullText, setFullText] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setFullText(null);
      setInitialized(false);
      return;
    }
    setInitialized(false);
    try {
      const raw = localStorage.getItem(`telop-score-fulltext-${projectId}`);
      setFullText(raw); // string or null
    } catch {
      setFullText(null);
    }
    setInitialized(true);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !initialized) return;
    if (fullText === null) return; // 未編集なので保存しない
    const handle = setTimeout(() => {
      safeSetItem(
        `telop-score-fulltext-${projectId}`,
        fullText,
        (msg) => toast({ title: msg, variant: "destructive" }),
        "譜割タブの歌詞（全曲）",
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [fullText, projectId, initialized, toast]);

  const updateFullText = useCallback((value: string) => {
    setFullText(value);
  }, []);

  return { fullText, setFullText: updateFullText };
}
