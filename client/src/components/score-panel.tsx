// 譜割（SCORE）タブのスプレッドシート UI（派生モード、BAR が行高のマスター / LYRIC は 1 つの textarea）。
//
// 設計：
//   - 全列を同じフォント（13px）と同じ行高（24px）で揃える
//   - BAR 列：各 SECTION 1 個の textarea。改行で行数を増やせて、その SECTION の高さが決まる
//     初期値は tokenizeBars()（4 拍子に基づく自動計算）。手動編集はオーバーライドとして保存
//   - SECTION 列：先頭行に名前（上合わせ）、残りはセル分の縦線のみ
//   - LYRIC 列：1 個の textarea で全曲分の歌詞を保持（一気にペースト可能）
//     区切り行（各 SECTION の終わり）は強制的に空行になる（A 案）
//     ユーザーが区切り行に文字を打っても、自動で次の SECTION の先頭に押し出される
//
// データ：
//   - BAR の手動編集は useScoreBarOverrides（telop-score-bars-{id}）に保存
//   - 全曲分の歌詞は useScoreFullText（telop-score-fulltext-{id}）に保存
//   - 既存の telop-score-v3（旧手入力データ）は読み取りのみ。書き戻しなし

import { useLayoutEffect, useMemo, useRef } from "react";
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
  fullText: string | null;
  onFullTextChange: (value: string) => void;
  barOverrides: Record<string, string>;
  onBarChange: (sectionId: string, value: string) => void;
};

const LINE_H = 24;
const FONT_SIZE = 13;

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
    const firstSection = sr.section.split("\n").map((s) => s.trim()).find((s) => s) || "";
    if (firstSection && !map[firstSection] && sr.lyric) {
      map[firstSection] = sr.lyric;
    }
  }
  return map;
}

type SectionView = {
  id: string;
  label: string;
  barText: string;
  /** SECTION の開始 grid 行（1-based）*/
  rowStart: number;
  /** content 行数 = barText の改行数 + 1（最低 1）*/
  contentLines: number;
  /** SECTION 全体の行数 = contentLines + 1（区切り）*/
  totalLines: number;
};

/** 入力テキストを「各 section の content 行 + 区切り空行」に整列する。
 *  行数は totalRows 固定。区切り行は強制的に空行になる。
 *  区切り行の位置に文字があった場合（ユーザーが入力した、または改行が消えて前詰めされた）、
 *  その行は捨てずに次セクションの先頭で消化する（持ち越し）。これにより、
 *  Backspace/Delete で改行を消した時に、別の行が消失するバグを防ぐ。 */
function reflowLyricText(input: string, sections: SectionView[]): string {
  const inputLines = input.split("\n");
  const result: string[] = [];
  let cursor = 0;
  for (let secIdx = 0; secIdx < sections.length; secIdx++) {
    const s = sections[secIdx];
    for (let i = 0; i < s.contentLines; i++) {
      result.push(inputLines[cursor] ?? "");
      cursor++;
    }
    // 区切り行：原則空行に強制。
    // 元々空 or 範囲外なら cursor を進める。
    // 文字が入っていたら cursor を進めず、次セクションの先頭で読まれるようにする（持ち越し）。
    const dividerLine = inputLines[cursor];
    if (dividerLine === undefined || dividerLine === "") {
      cursor++;
    }
    result.push("");
  }
  return result.join("\n");
}

/** pos（文字 index）を line/col に変換 */
function posToLineCol(text: string, pos: number): { line: number; col: number } {
  const before = text.slice(0, pos);
  const lines = before.split("\n");
  return { line: lines.length - 1, col: lines[lines.length - 1].length };
}

/** line/col を pos（文字 index）に変換。範囲外なら最寄りに丸める */
function lineColToPos(text: string, line: number, col: number): number {
  const lines = text.split("\n");
  const cappedLine = Math.max(0, Math.min(line, lines.length - 1));
  let pos = 0;
  for (let i = 0; i < cappedLine; i++) {
    pos += lines[i].length + 1;
  }
  pos += Math.max(0, Math.min(col, lines[cappedLine]?.length ?? 0));
  return pos;
}

export function ScorePanel({
  sectionBlocks,
  scoreRows,
  bpm,
  bpmGridOffset,
  lyrics,
  fullText,
  onFullTextChange,
  barOverrides,
  onBarChange,
}: Props) {
  // タイムラインの位置順（startBar 昇順）に必ず並べる。
  // sectionBlocks は配列順がタイムラインの追加順なので、ユーザーがブロックを動かしても
  // ここでは明示的にソートして、譜割タブが常に「左→右」の順に並ぶようにする。
  const sortedSectionBlocks = useMemo(
    () => [...sectionBlocks].sort((a, b) => a.startBar - b.startBar),
    [sectionBlocks],
  );

  const { sections, totalRows } = useMemo(() => {
    const sec: SectionView[] = [];
    let cursor = 1;
    for (const block of sortedSectionBlocks) {
      const totalBars = block.endBar - block.startBar;
      const autoBarText = tokenizeBars(totalBars).join("\n");
      const barText = barOverrides[block.id] ?? autoBarText;
      const lines = barText.split("\n");
      const contentLines = Math.max(1, lines.length);
      sec.push({
        id: block.id,
        label: block.label,
        barText,
        rowStart: cursor,
        contentLines,
        totalLines: contentLines + 1,
      });
      cursor += contentLines + 1;
    }
    return { sections: sec, totalRows: cursor - 1 };
  }, [sortedSectionBlocks, barOverrides]);

  // 初期値（fullText === null のときに使う）
  const initialFullText = useMemo(() => {
    if (!bpm || bpm <= 0 || sections.length === 0) return "";
    const beatsPerBar = 4;
    const secPerBar = (60 / bpm) * beatsPerBar;
    const legacyLyricMap = buildLegacyLyricMap(scoreRows);
    const allLines: string[] = [];
    for (const s of sections) {
      const block = sectionBlocks.find((b) => b.id === s.id);
      let baseText = "";
      if (block) {
        const startTime = bpmGridOffset + block.startBar * secPerBar;
        const endTime = bpmGridOffset + block.endBar * secPerBar;
        const matched = lyrics
          .filter((l) => l.startTime != null && l.startTime >= startTime && l.startTime < endTime)
          .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
        const telopText = matched.map((l) => l.text).join("\n");
        baseText = telopText || legacyLyricMap[block.label] || "";
      }
      const lines = baseText ? baseText.split("\n") : [];
      while (lines.length < s.contentLines) lines.push("");
      allLines.push(...lines.slice(0, s.contentLines), "");
    }
    return allLines.join("\n");
  }, [sectionBlocks, scoreRows, bpm, bpmGridOffset, lyrics, sections]);

  const rawDisplay = fullText !== null ? fullText : initialFullText;
  const displayLyric = useMemo(() => reflowLyricText(rawDisplay, sections), [rawDisplay, sections]);

  // cursor 位置を保存・復元するための ref
  const lyricRef = useRef<HTMLTextAreaElement>(null);
  const pendingCursor = useRef<{ line: number; col: number } | null>(null);

  // displayLyric が変わった直後に cursor 位置を復元する
  useLayoutEffect(() => {
    if (pendingCursor.current && lyricRef.current) {
      const { line, col } = pendingCursor.current;
      const newPos = lineColToPos(displayLyric, line, col);
      lyricRef.current.setSelectionRange(newPos, newPos);
      pendingCursor.current = null;
    }
  }, [displayLyric]);

  const handleLyricChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? 0;
    // 入力後の line/col を保存（reflow 後の displayLyric でも同じ line/col に置く）
    pendingCursor.current = posToLineCol(value, cursorPos);
    onFullTextChange(reflowLyricText(value, sections));
  };

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

  // 区切り行の Y 位置（content の終わり）
  const dividerYs = sections.map((s) => (s.rowStart - 1 + s.contentLines) * LINE_H);
  const totalHeight = totalRows * LINE_H;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="score-table" style={{ background: "transparent" }}>
      <Header />
      <div className="flex-1 overflow-y-auto" data-testid="score-scroll">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "64px 64px 1fr",
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
            // SECTION 列：上合わせ、span = contentLines
            cells.push(
              <div
                key={`${s.id}-sec`}
                style={{
                  gridColumn: 1,
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
            // BAR 列：1 個の textarea で行数を編集可能に
            cells.push(
              <textarea
                key={`${s.id}-bar`}
                value={s.barText}
                onChange={(e) => onBarChange(s.id, e.target.value)}
                spellCheck={false}
                rows={s.contentLines}
                style={{
                  gridColumn: 2,
                  gridRow: `${s.rowStart} / span ${s.contentLines}`,
                  border: 0,
                  borderRightWidth: 1,
                  borderRightStyle: "solid",
                  borderRightColor: TS_DESIGN.border,
                  outline: "none",
                  background: "transparent",
                  color: TS_DESIGN.text,
                  fontFamily: "inherit",
                  fontSize: FONT_SIZE,
                  lineHeight: `${LINE_H}px`,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "0.04em",
                  textAlign: "center",
                  resize: "none",
                  padding: 0,
                  height: `${s.contentLines * LINE_H}px`,
                  overflow: "hidden",
                  display: "block",
                }}
                data-testid={`score-bar-${s.id}`}
              />,
            );
            // 区切り行：縦線維持 + 横線中央
            const dividerRow = s.rowStart + s.contentLines;
            const dividerBg = `linear-gradient(to bottom, transparent 0, transparent ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2 - 1}px, ${TS_DESIGN.border} ${LINE_H / 2}px, transparent ${LINE_H / 2}px, transparent ${LINE_H}px)`;
            cells.push(
              <div
                key={`${s.id}-divsec`}
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
                key={`${s.id}-divbar`}
                style={{
                  gridColumn: 2,
                  gridRow: dividerRow,
                  borderRight: `1px solid ${TS_DESIGN.border}`,
                  backgroundImage: dividerBg,
                }}
              />,
            );
            return cells;
          })}

          {/* 右側：LYRIC textarea + 横線オーバーレイ。grid-row 1 / -1 で全行を貫通 */}
          <div
            style={{
              gridColumn: 3,
              gridRow: `1 / span ${totalRows}`,
              position: "relative",
            }}
          >
            {/* 横線オーバーレイ（区切り行の Y 位置に薄く） */}
            {dividerYs.map((y, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: y + LINE_H / 2 - 0.5,
                  height: 1,
                  background: TS_DESIGN.border,
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              />
            ))}
            <textarea
              ref={lyricRef}
              value={displayLyric}
              onChange={handleLyricChange}
              spellCheck={false}
              style={{
                position: "relative",
                zIndex: 1,
                width: "100%",
                minHeight: totalHeight,
                height: totalHeight,
                padding: "0 10px",
                border: 0,
                outline: "none",
                background: "transparent",
                color: TS_DESIGN.text,
                resize: "none",
                fontFamily: "inherit",
                fontSize: FONT_SIZE,
                lineHeight: `${LINE_H}px`,
                overflow: "auto",
                display: "block",
              }}
              data-testid="score-lyric-fulltext"
            />
          </div>
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
        gridTemplateColumns: "64px 64px 1fr",
        borderBottom: `1px solid ${TS_DESIGN.border}`,
      }}
    >
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>SECTION</div>
      <div style={{ borderRight: `1px solid ${TS_DESIGN.border}`, padding: "6px 4px", textAlign: "center", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>BAR</div>
      <div style={{ padding: "6px 10px", color: TS_DESIGN.text3, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>LYRIC</div>
    </div>
  );
}
