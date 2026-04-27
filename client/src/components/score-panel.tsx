// 譜割（SCORE）タブ：完全自動生成・読み取り専用のビュー。
//
// 仕様（のむさん最終合意）：
//   - タイムラインの SECTION ブロック（リハーサルマーク）と TELOP（歌詞）が source of truth
//   - 譜割タブはそれを「時間順 / SECTION 順」に並べて表示するだけ
//   - 編集機能はなし（textarea や prompt は使わない）
//   - SECTION を動かせば即時に譜割タブも再構築される
//
// 列構成：TIME | SECTION | BAR | LYRIC
//   - TIME：SECTION 開始時刻（m:ss）
//   - SECTION：ラベル（INTRO, A, サビ など）
//   - BAR：その SECTION の小節数を tokenizeBars で自動分解（4, 4, 2, 1, 2/4 など）
//   - LYRIC：SECTION の時間範囲（startTime 〜 endTime）に入った歌詞を順番に表示
//
// 行高は SECTION ごとに「BAR トークン数」と「LYRIC 行数」の大きい方で決まる。
// SECTION 同士の間には 1 行分の区切り（横線）を挿入する。

import { useMemo } from "react";
import type { LyricLine } from "@shared/schema";
import { TS_DESIGN } from "@/lib/designTokens";

export type SectionBlockForScore = { id: string; label: string; startBar: number; endBar: number };

type Props = {
  sectionBlocks: SectionBlockForScore[];
  bpm: number | null | undefined;
  bpmGridOffset: number;
  lyrics: LyricLine[];
  /** 現在再生位置（秒）。該当する BAR / LYRIC 行をハイライトするのに使う */
  currentTime?: number;
};

const LINE_H = 24;
const FONT_SIZE = 13;

/** 小節数をビート単位に分解して読みやすくする。例：6 → ["4", "2"]、5.5 → ["4", "1", "2/4"] */
function tokenizeBars(totalBars: number): string[] {
  const rounded = Math.round(totalBars * 4) / 4;
  if (rounded <= 0) return [];
  const tokens: string[] = [];
  let r = rounded;
  while (r >= 4 - 0.001) { tokens.push("4"); r -= 4; }
  while (r >= 2 - 0.001) { tokens.push("2"); r -= 2; }
  while (r >= 1 - 0.001) { tokens.push("1"); r -= 1; }
  const beats = Math.round(r * 4);
  if (beats > 0) tokens.push(`${beats}/4`);
  return tokens;
}

/** 秒数を「m:ss」形式の文字列に整形（負値は 0:00 にクランプ）。 */
function formatTimeMSS(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type SectionView = {
  id: string;
  label: string;
  /** 行 → BAR トークン文字列のマップ（歌詞タイミングに合わせて縦位置を配置） */
  barByRow: Map<number, string>;
  /** 行 → BAR トークンの時間範囲（startTime, endTime）。ハイライト判定用 */
  barTimeByRow: Map<number, { startTime: number; endTime: number }>;
  lyricLines: string[];
  /** 各歌詞行の startTime（同行のインデックスで対応） */
  lyricStartByRow: Map<number, number>;
  /** SECTION の開始 grid 行（1-based）*/
  rowStart: number;
  /** SECTION の中身の行数 = max(BAR トークン数, LYRIC 行数, 1) */
  contentLines: number;
  /** SECTION 開始時刻（秒） */
  startTimeSec: number;
  /** SECTION 終了時刻（秒）。最後の歌詞行の終了判定に使う */
  endTimeSec: number;
};

/** "4" → 4 小節、"2" → 2 小節、"1" → 1 小節、"3/4" → 0.75 小節 などに変換 */
function tokenBarLength(tok: string): number {
  if (tok === "4") return 4;
  if (tok === "2") return 2;
  if (tok === "1") return 1;
  if (tok.includes("/")) {
    const [num] = tok.split("/").map(Number);
    return Number.isFinite(num) ? num / 4 : 0;
  }
  return 0;
}

export function ScorePanel({ sectionBlocks, bpm, bpmGridOffset, lyrics, currentTime = 0 }: Props) {
  // タイムライン位置順（startBar 昇順）に必ず並べる。
  const sortedSectionBlocks = useMemo(
    () => [...sectionBlocks].sort((a, b) => a.startBar - b.startBar),
    [sectionBlocks],
  );

  const { sections, totalRows } = useMemo(() => {
    const sec: SectionView[] = [];
    let cursor = 1;
    const secPerBar = bpm && bpm > 0 ? (60 / bpm) * 4 : 0;
    for (const block of sortedSectionBlocks) {
      const totalBars = block.endBar - block.startBar;
      const barTokens = tokenizeBars(totalBars);
      const startTime = secPerBar > 0 ? bpmGridOffset + block.startBar * secPerBar : 0;
      const endTime = secPerBar > 0 ? bpmGridOffset + block.endBar * secPerBar : 0;

      // 歌詞の「中央時刻」が SECTION 範囲に入るか で判定。
      // 食って歌い出しても歌詞は SECTION 内で歌い切るので、中央なら確実に正しい SECTION に入る。
      const matchedLyrics = lyrics
        .filter((l) => {
          if (l.startTime == null) return false;
          const s = l.startTime;
          const e = l.endTime ?? s;
          const mid = (s + e) / 2;
          return mid >= startTime && mid < endTime;
        })
        .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
      const lyricLines = matchedLyrics.map((l) => l.text);
      const lyricStarts = matchedLyrics.map((l) => l.startTime as number);

      // BAR トークンを「歌詞タイミングに最も近い行」 の縦位置に配置する。
      // 歌詞が無いセクションは上から順番に並べる（従来通り）。
      const barByRow = new Map<number, string>();
      const barTimeByRow = new Map<number, { startTime: number; endTime: number }>();
      if (lyricLines.length === 0 || secPerBar <= 0) {
        let cumBars = 0;
        barTokens.forEach((tok, i) => {
          barByRow.set(i, tok);
          const tStart = startTime + cumBars * secPerBar;
          const tLen = tokenBarLength(tok);
          cumBars += tLen;
          barTimeByRow.set(i, { startTime: tStart, endTime: startTime + cumBars * secPerBar });
        });
      } else {
        let cumBars = 0;
        for (const tok of barTokens) {
          const tokenStartBar = cumBars; // SECTION 内の相対小節
          const tokenStartTime = startTime + tokenStartBar * secPerBar;
          const tLen = tokenBarLength(tok);
          const tokenEndTime = startTime + (cumBars + tLen) * secPerBar;
          // この BAR の開始時刻に最も近い歌詞行を探す
          let bestRow = 0;
          let minDist = Infinity;
          for (let i = 0; i < lyricStarts.length; i++) {
            const d = Math.abs(lyricStarts[i] - tokenStartTime);
            if (d < minDist) { minDist = d; bestRow = i; }
          }
          // 既に同じ行に置かれている場合は次の空き行に逃がす（重なり防止）
          let row = bestRow;
          while (barByRow.has(row)) row++;
          barByRow.set(row, tok);
          barTimeByRow.set(row, { startTime: tokenStartTime, endTime: tokenEndTime });
          cumBars += tLen;
        }
      }

      // 歌詞行ごとの startTime をマップに（行番号 → 開始秒）。
      const lyricStartByRow = new Map<number, number>();
      lyricStarts.forEach((t, i) => lyricStartByRow.set(i, t));

      const maxBarRow = barByRow.size > 0 ? Math.max(...Array.from(barByRow.keys())) + 1 : 0;
      const contentLines = Math.max(1, maxBarRow, lyricLines.length);
      sec.push({
        id: block.id,
        label: block.label,
        barByRow,
        barTimeByRow,
        lyricLines,
        lyricStartByRow,
        rowStart: cursor,
        contentLines,
        startTimeSec: startTime,
        endTimeSec: endTime,
      });
      cursor += contentLines + 1; // +1 = SECTION 間の区切り行
    }
    return { sections: sec, totalRows: cursor - 1 };
  }, [sortedSectionBlocks, bpm, bpmGridOffset, lyrics]);

  if (!bpm || bpm <= 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: "transparent" }}>
        <Header />
        <div style={{ padding: "24px 16px", color: TS_DESIGN.text3, fontSize: 11, lineHeight: 1.7 }}>
          BPM を検出するとここに譜割が表示されます。
        </div>
      </div>
    );
  }

  if (sectionBlocks.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: "transparent" }}>
        <Header />
        <div style={{ padding: "24px 16px", color: TS_DESIGN.text3, fontSize: 11, lineHeight: 1.7 }}>
          タイムラインに SECTION ブロックを配置すると、ここに譜割が自動で並びます。
        </div>
      </div>
    );
  }

  const totalHeight = totalRows * LINE_H;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: "transparent" }}>
      <Header />
      <div className="flex-1 overflow-y-auto" data-testid="score-scroll">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "56px 64px 64px 1fr",
            gridAutoRows: `${LINE_H}px`,
            position: "relative",
            fontFamily: "inherit",
            fontSize: FONT_SIZE,
            lineHeight: `${LINE_H}px`,
            minHeight: totalHeight,
          }}
        >
          {sections.flatMap((s) => {
            const cells: React.ReactNode[] = [];

            // TIME 列：SECTION 開始時刻、上合わせ、span = contentLines
            cells.push(
              <div
                key={`${s.id}-time`}
                style={{
                  gridColumn: 1,
                  gridRow: `${s.rowStart} / span ${s.contentLines}`,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  color: TS_DESIGN.text3,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "0.04em",
                }}
                data-testid={`score-time-${s.id}`}
              >
                <span style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}>{formatTimeMSS(s.startTimeSec)}</span>
              </div>,
            );

            // SECTION 列：ラベル、上合わせ、span = contentLines
            cells.push(
              <div
                key={`${s.id}-sec`}
                style={{
                  gridColumn: 2,
                  gridRow: `${s.rowStart} / span ${s.contentLines}`,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  color: "hsl(0 0% 75%)",
                  fontWeight: 500,
                }}
                data-testid={`score-section-${s.id}`}
              >
                <span style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}>{s.label}</span>
              </div>,
            );

            // BAR 列：歌詞タイミングに合わせて縦位置に配置（barByRow に格納済み）
            for (let i = 0; i < s.contentLines; i++) {
              const tok = s.barByRow.get(i) ?? "";
              const range = s.barTimeByRow.get(i);
              const isActive = !!range && currentTime >= range.startTime && currentTime < range.endTime;
              cells.push(
                <div
                  key={`${s.id}-bar-${i}`}
                  style={{
                    gridColumn: 3,
                    gridRow: s.rowStart + i,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRight: `1px solid ${TS_DESIGN.border}`,
                    color: isActive ? "#ffd34d" : TS_DESIGN.text3,
                    background: isActive ? "rgba(192, 138, 28, 0.18)" : "transparent",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "0.04em",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {tok}
                </div>,
              );
            }

            // LYRIC 列：時間範囲内の歌詞を 1 行ずつ表示（編集不可）
            for (let i = 0; i < s.contentLines; i++) {
              const text = s.lyricLines[i] ?? "";
              // この歌詞行のアクティブ判定：startTime ≤ currentTime < 次の行の startTime（または SECTION 終了）
              const lyricStart = s.lyricStartByRow.get(i);
              let lyricEnd: number | undefined;
              for (let j = i + 1; j < s.contentLines; j++) {
                const next = s.lyricStartByRow.get(j);
                if (next != null) { lyricEnd = next; break; }
              }
              if (lyricEnd == null) lyricEnd = s.endTimeSec;
              const isActive = lyricStart != null && currentTime >= lyricStart && currentTime < lyricEnd;
              cells.push(
                <div
                  key={`${s.id}-lyric-${i}`}
                  style={{
                    gridColumn: 4,
                    gridRow: s.rowStart + i,
                    padding: "0 10px",
                    color: isActive ? "#ffd34d" : TS_DESIGN.text,
                    background: isActive ? "rgba(192, 138, 28, 0.18)" : "transparent",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {text}
                </div>,
              );
            }

            // 区切り行：4 列分の縦線維持 + 横線中央
            const dividerRow = s.rowStart + s.contentLines;
            const dividerBg = `linear-gradient(to bottom, transparent 0, transparent ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2}px, transparent ${LINE_H / 2}px, transparent ${LINE_H}px)`;
            cells.push(
              <div
                key={`${s.id}-divtime`}
                style={{
                  gridColumn: 1,
                  gridRow: dividerRow,
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  backgroundImage: dividerBg,
                }}
              />,
            );
            cells.push(
              <div
                key={`${s.id}-divsec`}
                style={{
                  gridColumn: 2,
                  gridRow: dividerRow,
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  backgroundImage: dividerBg,
                }}
              />,
            );
            cells.push(
              <div
                key={`${s.id}-divbar`}
                style={{
                  gridColumn: 3,
                  gridRow: dividerRow,
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  backgroundImage: dividerBg,
                }}
              />,
            );
            cells.push(
              <div
                key={`${s.id}-divlyric`}
                style={{
                  gridColumn: 4,
                  gridRow: dividerRow,
                  backgroundImage: dividerBg,
                }}
              />,
            );

            return cells;
          })}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div
      className="shrink-0"
      style={{
        display: "grid",
        gridTemplateColumns: "56px 64px 64px 1fr",
        borderBottom: `1px solid ${TS_DESIGN.border}`,
      }}
    >
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>TIME</div>
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>SECTION</div>
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>BAR</div>
      <div style={{ padding: "6px 10px", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>LYRIC</div>
    </div>
  );
}
