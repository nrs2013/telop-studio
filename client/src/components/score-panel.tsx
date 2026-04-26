// 譜割（SCORE）タブのスプレッドシート UI（派生モード、コンパクト 1 行 = 1 SECTION）。
//
// 設計：
//   - 1 SECTION = 1 行（4 小節分割なし）
//   - SECTION 列：タイムラインの SECTION ブロック名（読み取り専用、グレー）
//   - BAR 列：総小節数を「4」基本で分解した連続表記（例：16 → "4 4 4 4"、6 → "4 2"、
//     4 + 2 拍 → "4 2/4"）読み取り専用、グレー
//   - LYRIC 列：自由記入。改行・空行、ユーザーの好きなように。textarea が行数に合わせて伸びる
//   - 行の下罫線が SECTION の区切り線になる（コンパクト）
//
// データ：
//   - sectionBlocks（マスター）が空の場合、project.tsx 側で scoreRows から派生したものを渡す
//   - LYRIC のユーザー上書きは useLyricOverrides に保存（telop-lyric-overrides-{id}）、key はブロック ID
//   - 既存の telop-score-v3（旧手入力データ）は読み取りのみ。書き戻しなし
//     → 旧データの LYRIC 値は「override も TELOP も無いとき」のフォールバック

import { Fragment, useMemo } from "react";
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
  barsText: string;
  lyricInitial: string;
  lyricKey: string;
};

// 総小節数を 4 基本で分解：16 → "4 4 4 4"、6 → "4 2"、5 → "4 1"、4.5 → "4 2/4"、4.75 → "4 3/4"
function tokenizeBars(totalBars: number): string {
  // 1 拍 (= 0.25 小節) 単位で丸めて誤差吸収
  const rounded = Math.round(totalBars * 4) / 4;
  if (rounded <= 0) return "";
  const tokens: string[] = [];
  let r = rounded;
  while (r >= 4 - 0.001) { tokens.push("4"); r -= 4; }
  while (r >= 2 - 0.001) { tokens.push("2"); r -= 2; }
  while (r >= 1 - 0.001) { tokens.push("1"); r -= 1; }
  // 残った拍数（1 / 2 / 3 拍）は "N/4" で表記（音楽用語：N 拍）
  const beats = Math.round(r * 4);
  if (beats > 0) tokens.push(`${beats}/4`);
  return tokens.join(" ");
}

// 旧 scoreRows.lyric を SECTION 名 → 歌詞テキスト の Map に変換（フォールバック用）
function buildLegacyLyricMap(scoreRows: ScoreRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const sr of scoreRows) {
    // セクション名は first non-empty 行を取る
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

    // TELOP マッチ：開始時刻が SECTION の時間範囲に入る歌詞ブロック → 改行で結合
    const matched = lyrics
      .filter(l => l.startTime != null && l.startTime >= startTime && l.startTime < endTime)
      .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    const telopText = matched.map(l => l.text).join("\n");

    // 初期値の優先順位：TELOP マッチ → 旧 譜割 SECTION 名一致 → 空
    const lyricInitial = telopText || legacyLyricMap[block.label] || "";

    result.push({
      key: block.id,
      sectionLabel: block.label,
      barsText: tokenizeBars(totalBars),
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

  const readOnlyCellStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    padding: "8px 6px",
    color: TS_DESIGN.text3,
    fontSize: 13,
    fontFamily: "inherit",
    justifyContent: "center",
  };

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      data-testid="score-table"
      style={{ background: TS_DESIGN.bg2 }}
    >
      <div className="shrink-0" style={{ display: "grid", gridTemplateColumns: "64px 1fr 2fr", borderBottom: `1px solid ${TS_DESIGN.border}` }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "64px 1fr 2fr" }}>
            {rows.map((row) => {
              const overrideVal = overrides[row.lyricKey];
              const lyric = overrideVal !== undefined ? overrideVal : row.lyricInitial;
              return (
                <Fragment key={row.key}>
                  <div style={{ ...readOnlyCellStyle, borderRight: `1px solid ${TS_DESIGN.border}`, borderBottom: `1px solid ${TS_DESIGN.border}` }} data-testid={`score-section-derived-${row.key}`}>
                    {row.sectionLabel}
                  </div>
                  <div style={{ ...readOnlyCellStyle, borderRight: `1px solid ${TS_DESIGN.border}`, borderBottom: `1px solid ${TS_DESIGN.border}`, fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }} data-testid={`score-bars-derived-${row.key}`}>
                    {row.barsText}
                  </div>
                  <label style={{ display: "flex", alignItems: "flex-start", cursor: "text", borderBottom: `1px solid ${TS_DESIGN.border}` }}>
                    <textarea
                      value={lyric}
                      onChange={(e) => onLyricOverrideChange(row.lyricKey, e.target.value)}
                      rows={Math.max(1, lyric.split("\n").length)}
                      className="w-full bg-transparent outline-none resize-none text-left"
                      style={{ color: TS_DESIGN.text, fontSize: 13, lineHeight: 1.6, padding: "8px 10px", border: 0, fontFamily: "inherit" }}
                      data-testid={`score-lyric-derived-${row.key}`}
                    />
                  </label>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
