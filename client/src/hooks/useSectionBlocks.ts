// タイムライン譜割モード（時間ベース SECTION ブロック）の state 管理フック。
// 既存の手入力譜割（telop-score-v3-*）とは別キー `telop-sections-v1-{projectId}` で完全独立。
//
// 安全装置（DATA_SAFETY_RULES.md 準拠）：
//   - 読み込み時の filter は型ガードのみ。データ内容は変えない。
//   - 既存キーへの書き戻しは初期化完了後のみ（initialized フラグで保護）。
//   - 保存失敗は safeSetItem 経由で toast 通知。
//
// 注：現時点でこのデータを描画する UI は外されているが、
//     ユーザーが過去にドラッグして配置した位置データを保持するため、
//     load/save ロジックは保存しておく（再導入時に即復元できる）。

import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { safeSetItem } from "@/lib/safeStorage";

export type SectionBlock = { id: string; label: string; startBar: number; endBar: number };

export function useSectionBlocks(projectId: string | undefined) {
  const { toast } = useToast();
  const [sectionBlocks, setSectionBlocks] = useState<SectionBlock[]>([]);
  const [sectionBlocksInit, setSectionBlocksInit] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setSectionBlocksInit(false);
    try {
      const raw = localStorage.getItem(`telop-sections-v1-${projectId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSectionBlocks(parsed.filter((b: any) =>
            b && typeof b.id === "string" && typeof b.label === "string"
            && typeof b.startBar === "number" && typeof b.endBar === "number"
          ));
        } else {
          setSectionBlocks([]);
        }
      } else {
        setSectionBlocks([]);
      }
    } catch {
      setSectionBlocks([]);
    }
    setSectionBlocksInit(true);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !sectionBlocksInit) return;
    const h = setTimeout(() => {
      safeSetItem(
        `telop-sections-v1-${projectId}`,
        JSON.stringify(sectionBlocks),
        (msg) => toast({ title: msg, variant: "destructive" }),
        "SECTION ブロックの位置データ",
      );
    }, 250);
    return () => clearTimeout(h);
  }, [sectionBlocks, projectId, sectionBlocksInit, toast]);

  return { sectionBlocks, setSectionBlocks };
}
