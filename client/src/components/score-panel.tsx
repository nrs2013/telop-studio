// 譜割（SCORE）タブのスプレッドシート UI（派生モード、行高グリッド方式）。
//
// 設計：
//   - 全列を同じフォント・同じ行高（24px）で揃える
//   - 1 SECTION = 縦に複数行を占める「行グループ」
//   - 行グループの高さ = max(BAR トークン数, LYRIC 行数) + 1（区切り行）
//     LYRIC が長くなれば行グループ全体が下に伸びる（線も追従）
//   - SECTION 列：先頭 1 行に名前を上合わせ、残りは空
//   - BAR 列：トークンを 1 行ずつ縦積み、残りは空セル
//   - LYRIC 列：textarea。同じ行高なので各行が左の行と揃う
//   - SECTION 間に空 1 行＋3 列横通しの薄い罫線で区切り
//
// データ：
//   - sectionBlocks（マスター）が空のときは project.tsx 側で scoreRows から派生したものが渡る
//   - LYRIC のユーザー上書きは useLyricOverrides に保存（telop-lyric-overrides-{id}）、key はブロック ID
//   - 既存の telop-score-v3 は読み取りのみ（フォールバック）

import { useMemo } from "react";
import type { ScoreRow } from "@/hooks/useScoreRows";
import type { LyricLine } from "@shared/schema";
import { TS_DESIGN } from "@/lib/designTokens";

export type SectionBlockForScore = { id: string; label: string; startBar: number; endBar: number };

type Props = {
  sectionBlocks: SectionBlockForScore[];
  scoreRows: ScoreRow[];
  bpm: number | null | undefined;
  bpmGridOffset: number;
  lyrics: LyricLine[];
  overrides: Record<string, string>;
  onLyricOverrideChange: (key: string, value: string) => void;
};

type DisplayRow = {
  key: string;
  sectionLabel: string;
  barsTokens: string[];
  lyricInitial: string;
  lyricKey: string;
};

const LINE_H = 24;
const FONT_SIZE = 13;

// 総小節数を 4 基本で分解：16 → ["4","4","4","4"]、6 → ["4","2"]、4.5 → ["4","2/4"]
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

function buildLegacyLyricMap(scoreRows: ScoreRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const sr of scoreRows) {
    const firstSection = sr.section.split("\n").map(s => s.trim()).find(s => s) || "";
    if (firstSection && !map[firstSection] && sr.lyric) {
      map[firstSection] = sr.lyric;
    }
  }
  return map;
}

function buildDisplayRows(
  blocks: SectionBlockForScore[],
  bpm: number,
  gridOffset: number,
  lyrics: LyricLine[],
  scoreRows: ScoreRow[],
): DisplayRow[] {
  if (blocks.length === 0) return [];
  const beatsPerBar = 4;
  const secPerBar = (60 / bpm) * beatsPerBar;

  const legacyLyricMap = buildLegacyLyricMap(scoreRows);

  const result: DisplayRow[] = [];
  for (const block of blocks) {
    const totalBars = block.endBar - block.startBar;
    const startTime = gridOffset + block.startBar * secPerBar;
    const endTime = gridOffset + block.endBar * secPerBar;

    const matched = lyrics
      .filter(l => l.startTime != null && l.startTime >= startTime && l.startTime < endTime)
      .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    const telopText = matched.map(l => l.text).join("\n");

    const lyricInitial = telopText || legacyLyricMap[block.label] || "";

    result.push({
      key: block.id,
      sectionLabel: block.label,
      barsTokens: tokenizeBars(totalBars),
      lyricInitial,
      lyricKey: block.id,
    });
  }
  return result;
}

export function ScorePanel({ sectionBlocks, scoreRows, bpm, bpmGridOffset, lyrics, overrides, onLyricOverrideChange }: Props) {
  const rows = useMemo(() => {
    if (!bpm || bpm <= 0) return [];
    return buildDisplayRows(sectionBlocks, bpm, bpmGridOffset, lyrics, scoreRows);
  }, [sectionBlocks, bpm, bpmGridOffset, lyrics, scoreRows]);

  const sharedTextStyle: React.CSSProperties = {
    fontFamily: "inherit",
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_H}px`,
  };

  // 中央に薄い横線を引いた背景（区切り行に使用）
  const dividerBg = `linear-gradient(to bottom, transparent 0, transparent ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2}px, transparent ${LINE_H / 2}px, transparent ${LINE_H}px)`;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      data-testid="score-table"
      style={{ background: TS_DESIGN.bg2 }}
    >
      <div className="shrink-0" style={{ display: "grid", gridTemplateColumns: "64px 64px 1fr", borderBottom: `1px solid ${TS_DESIGN.border}` }}>
        <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>SECTION</div>
        <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>BAR</div>
        <div style={{ padding: "6px 10px", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>LYRIC</div>
      </div>
      <div className="flex-1 overflow-y-auto" data-testid="score-scroll">
        {rows.length === 0 ? (
          <div style={{ padding: "24px 16px", color: TS_DESIGN.text3, fontSize: 11, lineHeight: 1.7, letterSpacing: "0.04em" }}>
            {!bpm || bpm <= 0
              ? "BPM を検出するとここに譜割が表示されます。"
              : "タイムラインに SECTION ブロックを配置すると、ここに譜割が自動で並びます。"}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "64px 64px 1fr",
              gridAutoRows: `${LINE_H}px`,
              ...sharedTextStyle,
            }}
          >
            {rows.flatMap((row) => {
              const overrideVal = overrides[row.lyricKey];
              const lyric = overrideVal !== undefined ? overrideVal : row.lyricInitial;
              const lyricLines = Math.max(1, lyric.split("\n").length);
              const contentLines = Math.max(row.barsTokens.length, lyricLines);
              return [
                // SECTION 列：上合わせ、ラベルは 1 行目のみ
                <div
                  key={`${row.key}-sec`}
                  style={{
                    gridRow: `span ${contentLines}`,
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    padding: 0,
                    borderRight: `1px solid ${TS_DESIGN.border}`,
                    color: "hsl(0 0% 75%)",
                    fontWeight: 500,
                    height: contentLines * LINE_H,
                  }}
                  data-testid={`score-section-${row.key}`}
                >
                  <span style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}>{row.sectionLabel}</span>
                </div>,

                // BAR 列：トークンを縦積み（残りは空）
                <div
                  key={`${row.key}-bar`}
                  style={{
                    gridRow: `span ${contentLines}`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    borderRight: `1px solid ${TS_DESIGN.border}`,
                    color: TS_DESIGN.text3,
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "0.04em",
                    height: contentLines * LINE_H,
                  }}
                  data-testid={`score-bars-${row.key}`}
                >
                  {row.barsTokens.map((tok, i) => (
                    <div key={i} style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}>{tok}</div>
                  ))}
                </div>,

                // LYRIC 列：textarea（contentLines 行ぶんの高さ）
                <label
                  key={`${row.key}-lyric`}
                  style={{
                    gridRow: `span ${contentLines}`,
                    display: "block",
                    height: contentLines * LINE_H,
                  }}
                >
                  <textarea
                    value={lyric}
                    onChange={(e) => onLyricOverrideChange(row.lyricKey, e.target.value)}
                    rows={contentLines}
                    spellCheck={false}
                    style={{
                      width: "100%",
                      height: contentLines * LINE_H,
                      padding: "0 10px",
                      border: 0,
                      outline: "none",
                      background: "transparent",
                      color: TS_DESIGN.text,
                      resize: "none",
                      fontFamily: "inherit",
                      fontSize: FONT_SIZE,
                      lineHeight: `${LINE_H}px`,
                      overflow: "hidden",
                    }}
                    data-testid={`score-lyric-${row.key}`}
                  />
                </label>,

                // 区切り行：3 列分割で横線＋縦線維持
                <div
                  key={`${row.key}-divsec`}
                  style={{ height: LINE_H, borderRight: `1px solid ${TS_DESIGN.border}`, backgroundImage: dividerBg }}
                />,
                <div
                  key={`${row.key}-divbar`}
                  style={{ height: LINE_H, borderRight: `1px solid ${TS_DESIGN.border}`, backgroundImage: dividerBg }}
                />,
                <div
                  key={`${row.key}-divlyr`}
                  style={{ height: LINE_H, backgroundImage: dividerBg }}
                />,
              ];
            })}
          </div>
        )}
      </div>
    </div>
  );
}

