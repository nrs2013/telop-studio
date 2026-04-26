// 譜割タブの LYRIC 列ユーザー上書きを管理するフック。
// SECTION ラベル + 行オフセット（"1A-0", "1A-1", "INTER-0" 等）をキーとして保存。
//
// 設計：
//   - SECTION 名 + その SECTION 内での何行目かをキーに使う（タイムライン構造が
//     変わってもなるべく対応がズレないため）
//   - 値は ユーザーが入力した歌詞テキスト
//   - localStorage キー：telop-lyric-overrides-{projectId}
//   - 保存は safeSetItem 経由（失敗時 toast 通知）
//
// 安全装置（DATA_SAFETY_RULES.md 準拠）：
//   - 既存の譜割データ（telop-score-v3）には触らない
//   - 既存の SECTION ブロック（telop-sections-v1）にも触らない
//   - このキーは新規。データ加工・マイグレーションなし

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { safeSetItem } from "@/lib/safeStorage";

export type LyricOverrides = Record<string, string>;

export function useLyricOverrides(projectId: string | undefined) {
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<LyricOverrides>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setOverrides({});
      setInitialized(false);
      return;
    }
    setInitialized(false);
    try {
      const raw = localStorage.getItem(`telop-lyric-overrides-${projectId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // 防御的：value が string のものだけ採用
          const cleaned: LyricOverrides = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") cleaned[k] = v;
          }
          setOverrides(cleaned);
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

  // 保存はデバウンス
  useEffect(() => {
    if (!projectId || !initialized) return;
    const handle = setTimeout(() => {
      safeSetItem(
        `telop-lyric-overrides-${projectId}`,
        JSON.stringify(overrides),
        (msg) => toast({ title: msg, variant: "destructive" }),
        "譜割タブの歌詞編集",
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [overrides, projectId, initialized, toast]);

  const setOverride = useCallback((key: string, value: string) => {
    setOverrides(prev => {
      // 空文字なら削除（オーバーライド解除 = TELOP/初期値に戻る）
      if (value === "") {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  return { overrides, setOverride };
}
