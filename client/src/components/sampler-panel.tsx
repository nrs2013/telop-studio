// SAMPLER パネル：タイムラインの SECTION ブロック（リハーサルマーク）から自動生成されるボタン群。
// クリックすると該当 SECTION の 2 小節前から再生。
// 再生位置に応じて該当ボタンが黄色く光る（追従ハイライト）。
//
// データソース：
//   - sectionBlocks（タイムライン側のリハーサルマーク）が優先
//   - sectionBlocks が空のときは scoreRows（旧手入力データ）から派生して表示

import type { MutableRefObject } from "react";
import type { ScoreRow } from "@/hooks/useScoreRows";
import { TS_DESIGN } from "@/lib/designTokens";

export type SamplerSectionBlock = { id: string; label: string; startBar: number; endBar: number };

type Props = {
  scoreRows: ScoreRow[];
  sectionBlocks: SamplerSectionBlock[];
  bpm: number | null | undefined;
  bpmGridOffset: number;
  currentTime: number;
  isPlayingRef: MutableRefObject<boolean>;
  seekTo: (time: number) => void;
  togglePlay: () => void;
};

export function SamplerPanel({
  scoreRows,
  sectionBlocks,
  bpm,
  bpmGridOffset,
  currentTime,
  isPlayingRef,
  seekTo,
  togglePlay,
}: Props) {
  return (
    <div
      className="shrink-0 flex flex-col overflow-hidden"
      style={{ width: 180, border: `1px solid ${TS_DESIGN.border}`, backgroundColor: TS_DESIGN.bg2 }}
      data-testid="sampler-panel"
    >
      <div className="shrink-0" style={{ padding: "6px 10px", borderBottom: `1px solid ${TS_DESIGN.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "hsl(48 100% 55%)", fontSize: 9, letterSpacing: "0.18em", fontWeight: 700 }}>SAMPLER</span>
        <span style={{ color: TS_DESIGN.text3, fontSize: 8 }}>2小節前から再生</span>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }} data-testid="sampler-list">
        {(() => {
          const offset = bpmGridOffset;
          if (!bpm || bpm <= 0) {
            return <div style={{ color: TS_DESIGN.text3, fontSize: 10, padding: "8px 4px" }}>BPM 未検出。<br/>先に BPM 検出してください。</div>;
          }
          const beatsPerBar = 4;
          const secPerBar = (60 / bpm) * beatsPerBar;
          // 1 パス目：全 SECTION の時間を集める
          const sectionItems: { id: string; label: string; sectionTime: number; cueTime: number }[] = [];
          if (sectionBlocks.length > 0) {
            // 優先：タイムラインのリハーサルマークから時間を計算
            // 必ず startBar 昇順に並べてから処理（タイムライン位置順 = 演奏順）
            const sortedBlocks = [...sectionBlocks].sort((a, b) => a.startBar - b.startBar);
            for (const block of sortedBlocks) {
              const sectionTime = offset + block.startBar * secPerBar;
              sectionItems.push({
                id: block.id,
                label: block.label,
                sectionTime,
                cueTime: Math.max(0, sectionTime - 2 * secPerBar),
              });
            }
          } else {
            // フォールバック：旧手入力 scoreRows から派生
            let cumBars = 0;
            for (const row of scoreRows) {
              const secLines = row.section.split("\n");
              const barLines = row.bars.split("\n");
              const maxLines = Math.max(secLines.length, barLines.length);
              for (let i = 0; i < maxLines; i++) {
                const label = (secLines[i] || "").trim();
                if (label) {
                  const sectionTime = offset + cumBars * secPerBar;
                  sectionItems.push({ id: `${row.id}-${i}`, label, sectionTime, cueTime: Math.max(0, sectionTime - 2 * secPerBar) });
                }
                const barText = barLines[i] || "";
                const nums = barText.match(/\d+/g) || [];
                cumBars += nums.reduce((s, n) => s + parseInt(n, 10), 0);
              }
            }
          }
          if (sectionItems.length === 0) {
            return <div style={{ color: TS_DESIGN.text3, fontSize: 10, padding: "8px 4px" }}>譜割タブの SECTION 欄に書き込むと、ここにボタンが並びます。</div>;
          }
          // 2 パス目：currentTime がどの SECTION に属するか判定 → ハイライト
          return sectionItems.map((s, idx) => {
            const nextTime = sectionItems[idx + 1]?.sectionTime ?? Infinity;
            const isActive = currentTime >= s.sectionTime && currentTime < nextTime;
            return (
              <button
                key={s.id}
                onClick={() => {
                  seekTo(s.cueTime);
                  if (!isPlayingRef.current) togglePlay();
                }}
                className="hover:bg-white/5 active:bg-white/10 transition-colors"
                style={{
                  background: isActive ? "rgba(229,191,61,0.2)" : TS_DESIGN.surface,
                  border: `1px solid ${isActive ? "hsl(48 100% 50%)" : TS_DESIGN.border}`,
                  borderRadius: 4,
                  padding: "8px 10px",
                  color: isActive ? "hsl(48 100% 70%)" : TS_DESIGN.text,
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  letterSpacing: "0.06em",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: isActive ? "0 0 0 1px hsl(48 100% 50% / 0.4)" : "none",
                }}
                data-testid={`sampler-btn-${s.id}`}
                data-active={isActive ? "1" : undefined}
                title={`${s.label} の 2 小節前から再生`}
              >▶  {s.label.toUpperCase()}</button>
            );
          });
        })()}
      </div>
    </div>
  );
}
