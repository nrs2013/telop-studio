// 譜割（SCORE）タブのスプレッドシート UI（派生モード）。
//
// 設計：
//   - SECTION 列：タイムラインの SECTION ブロックから自動派生（読み取り専用、グレー）
//   - BAR 列：ブロックの長さを 4 小節単位で分解（読み取り専用、グレー）
//   - LYRIC 列：TELOP 歌詞ブロックから時間で自動引き当て、ユーザー編集で上書き可
//   - SECTION の切れ目には空白行を 1 行差し込んで視覚的に区切る
//
// データ：
//   - sectionBlocks（マスター）が空の場合、project.tsx 側で scoreRows から派生したものを渡す
//   - LYRIC のユーザー上書きは useLyricOverrides に保存（telop-lyric-overrides-{id}）
//   - 既存の telop-score-v3（旧手入力データ）は読み取りのみ。書き戻しなし。
//     → 旧データの LYRIC 値は「override も TELOP も無いとき」のフォールバックとして使う

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

type DisplayRow =
  | { key: string; kind: "row"; sectionLabel: string; barsText: string; lyricInitial: string; lyricKey: string }
  | { key: string; kind: "separator" };

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
  const CHUNK_BARS = 4;

  // 旧 scoreRows.lyric を「SECTION 名 + そのセクション内の何チャンク目か」のキーで引ける表に変換
  // 1 行のセル内に複数行歌詞が入ってる場合、各 4 小節チャンクに 1 行ずつ割り当てる
  const legacyLyricMap: Record<string, string> = {};
  {
    const sectionRowIdx = new Map<string, number>();
    for (const sr of scoreRows) {
      const secLines = sr.section.split("\n");
      const barLines = sr.bars.split("\n");
      const lyricLines = sr.lyric.split("\n");
      const maxLines = Math.max(secLines.length, barLines.length);
      let currentSection = "";
      for (let i = 0; i < maxLines; i++) {
        const label = (secLines[i] || "").trim();
        if (label) {
          currentSection = label;
          if (!sectionRowIdx.has(currentSection)) sectionRowIdx.set(currentSection, 0);
        }
        if (!currentSection) continue;
        const lyric = lyricLines[i] || "";
        const numBars = ((barLines[i] || "").match(/\d+/g) || []).reduce((s, n) => s + parseInt(n, 10), 0);
        const chunks = Math.max(1, Math.ceil(numBars / CHUNK_BARS));
        // この行の歌詞を chunks 個に分けて入れる
        const lyricBits = lyric ? [lyric] : [];
        let idx = sectionRowIdx.get(currentSection) || 0;
        for (let c = 0; c < chunks; c++) {
          const key = `${currentSection}-${idx + c}`;
          if (lyricBits[c] && !legacyLyricMap[key]) {
            legacyLyricMap[key] = lyricBits[c];
          }
        }
        sectionRowIdx.set(currentSection, idx + chunks);
      }
    }
  }

  const result: DisplayRow[] = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const totalBars = block.endBar - block.startBar;
    let offset = 0;
    let rowInSection = 0;
    while (offset < totalBars) {
      const thisBars = Math.min(CHUNK_BARS, totalBars - offset);
      const startBar = block.startBar + offset;
      const startTime = gridOffset + startBar * secPerBar;
      const endTime = gridOffset + (startBar + thisBars) * secPerBar;

      // TELOP マッチ：開始時刻が [startTime, endTime) に入る歌詞ブロック
      const matched = lyrics
        .filter(l => l.startTime != null && l.startTime >= startTime && l.startTime < endTime)
        .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
      const telopText = matched.map(l => l.text).join("\n");

      const lyricKey = `${block.label}-${rowInSection}`;
      const lyricInitial = telopText || legacyLyricMap[lyricKey] || "";

      // BAR 列の表示テキスト：4 小節は "4"、端数は数値そのまま
      const barsText = thisBars === Math.floor(thisBars) ? `${thisBars}` : thisBars.toFixed(2);

      result.push({
        key: `${block.id}-${offset}`,
        kind: "row",
        sectionLabel: rowInSection === 0 ? block.label : "",
        barsText,
        lyricInitial,
        lyricKey,
      });
      offset += thisBars;
      rowInSection += 1;
    }
    // SECTION の切れ目に空白行（最後のブロックの後には入れない）
    if (bi < blocks.length - 1) {
      result.push({ key: `sep-${block.id}`, kind: "separator" });
    }
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
    minHeight: 28,
    padding: "4px 6px",
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
      <div className="shrink-0" style={{ display: "grid", gridTemplateColumns: "64px 56px 1fr", borderBottom: `1px solid ${TS_DESIGN.border}` }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "64px 56px 1fr" }}>
            {rows.map((row) => {
              if (row.kind === "separator") {
                return (
                  <Fragment key={row.key}>
                    <div style={{ height: 12, borderRight: `1px solid ${TS_DESIGN.border}` }} />
                    <div style={{ height: 12, borderRight: `1px solid ${TS_DESIGN.border}` }} />
                    <div style={{ height: 12 }} />
                  </Fragment>
                );
              }
              const overrideVal = overrides[row.lyricKey];
              const lyric = overrideVal !== undefined ? overrideVal : row.lyricInitial;
              return (
                <Fragment key={row.key}>
                  <div style={{ ...readOnlyCellStyle, borderRight: `1px solid ${TS_DESIGN.border}` }} data-testid={`score-section-derived-${row.key}`}>
                    {row.sectionLabel}
                  </div>
                  <div style={{ ...readOnlyCellStyle, borderRight: `1px solid ${TS_DESIGN.border}` }} data-testid={`score-bars-derived-${row.key}`}>
                    {row.barsText}
                  </div>
                  <label style={{ display: "flex", alignItems: "flex-start", minHeight: 28, cursor: "text" }}>
                    <textarea
                      value={lyric}
                      onChange={(e) => onLyricOverrideChange(row.lyricKey, e.target.value)}
                      rows={Math.max(1, lyric.split("\n").length)}
                      className="w-full bg-transparent outline-none resize-none text-left"
                      style={{ color: TS_DESIGN.text, fontSize: 13, lineHeight: 1.5, minHeight: 28, padding: "4px 10px", border: 0, fontFamily: "inherit" }}
                      data-testid={`score-lyric-derived-${row.key}`}
                      placeholder={overrideVal === undefined && row.lyricInitial === "" ? "" : undefined}
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
