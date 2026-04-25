// 譜割（SCORE）タブのスプレッドシート UI。
// 3 列（SECTION / BAR / LYRIC）の textarea。
// Cmd+Return：3 セルのカーソル位置に空行を 1 行挿入
// Cmd+Delete：上の空行を削除（Cmd+Return の取り消し）
// Tab / Shift+Tab：セル間移動（最後の LYRIC では何もしない）
// IME 変換中はキーボードショートカット無効。

import { Fragment } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ScoreRow } from "@/hooks/useScoreRows";
import { TS_DESIGN } from "@/lib/designTokens";

type Props = {
  scoreRows: ScoreRow[];
  setScoreRows: Dispatch<SetStateAction<ScoreRow[]>>;
  updateScoreRow: (idx: number, patch: Partial<{ section: string; bars: string; lyric: string }>) => void;
};

export function ScorePanel({ scoreRows, setScoreRows, updateScoreRow }: Props) {
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
        <div style={{ display: "grid", gridTemplateColumns: "64px 56px 1fr" }}>
          {scoreRows.map((row, idx) => {
            const onCellKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, col: "section" | "bars" | "lyric") => {
              // 日本語入力（IME）変換中は何もしない（ Enter で行追加されたり Tab で文字消えたりするのを防ぐ）
              if (e.nativeEvent.isComposing || (e.nativeEvent as any).keyCode === 229) return;
              // Cmd+Return：カーソルがいる行の上に空行を 1 つ挿入（3 セル同時、行インデックス基準）
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                const ta0 = e.currentTarget;
                const cursorPos = ta0.selectionStart;
                const currentValue = ta0.value;
                // カーソルが何行目にいるか（0-indexed）
                const lineIdx = currentValue.slice(0, cursorPos).split("\n").length - 1;
                const insertAt = (value: string, idx: number): string => {
                  const lines = value.split("\n");
                  while (lines.length < idx) lines.push("");
                  lines.splice(idx, 0, "");
                  return lines.join("\n");
                };
                setScoreRows(prev => prev.map((r, i) => i === idx ? {
                  ...r,
                  section: insertAt(r.section, lineIdx),
                  bars: insertAt(r.bars, lineIdx),
                  lyric: insertAt(r.lyric, lineIdx),
                } : r));
                setTimeout(() => {
                  const ta = document.querySelector(`[data-testid="score-${col}-${idx}"]`) as HTMLTextAreaElement | null;
                  if (ta) { ta.focus(); ta.setSelectionRange(cursorPos + 1, cursorPos + 1); }
                }, 50);
                return;
              }
              // Cmd+Delete：カーソルの 1 つ上の行が空なら、それを削除（3 セル同時）。空でなければ何もしない。
              if ((e.metaKey || e.ctrlKey) && (e.key === "Backspace" || e.key === "Delete")) {
                e.preventDefault();
                const ta0 = e.currentTarget;
                const cursorPos = ta0.selectionStart;
                const currentValue = ta0.value;
                const lineIdx = currentValue.slice(0, cursorPos).split("\n").length - 1;
                if (lineIdx <= 0) return;
                const currentLines = currentValue.split("\n");
                if (currentLines[lineIdx - 1] !== "") return;
                const removeAt = (value: string, idx: number): string => {
                  const lines = value.split("\n");
                  if (lines.length > idx && lines[idx] === "") {
                    lines.splice(idx, 1);
                  }
                  return lines.join("\n");
                };
                setScoreRows(prev => prev.map((r, i) => i === idx ? {
                  ...r,
                  section: removeAt(r.section, lineIdx - 1),
                  bars: removeAt(r.bars, lineIdx - 1),
                  lyric: removeAt(r.lyric, lineIdx - 1),
                } : r));
                setTimeout(() => {
                  const ta = document.querySelector(`[data-testid="score-${col}-${idx}"]`) as HTMLTextAreaElement | null;
                  if (ta) { ta.focus(); ta.setSelectionRange(Math.max(0, cursorPos - 1), Math.max(0, cursorPos - 1)); }
                }, 50);
                return;
              }
              if (e.key === "Tab") {
                e.preventDefault();
                const order: ("section" | "bars" | "lyric")[] = ["section", "bars", "lyric"];
                const colIdx = order.indexOf(col);
                let nextRow = idx;
                let nextColIdx = colIdx + (e.shiftKey ? -1 : 1);
                if (nextColIdx >= order.length) { nextRow += 1; nextColIdx = 0; }
                else if (nextColIdx < 0) { nextRow -= 1; nextColIdx = order.length - 1; }
                // 先頭で Shift+Tab、末尾の LYRIC で Tab → 何もしない
                if (nextRow < 0 || nextRow >= scoreRows.length) return;
                const nextCol = order[nextColIdx];
                const sel = `[data-testid="score-${nextCol}-${nextRow}"]`;
                const next = document.querySelector(sel) as HTMLTextAreaElement | null;
                if (next) {
                  next.focus();
                  const len = next.value.length;
                  next.setSelectionRange(len, len);
                }
              }
            };
            const cellBase = { display: "flex", alignItems: "flex-start", minHeight: 28, cursor: "text" } as const;
            return (
              <Fragment key={row.id}>
                <label style={{ ...cellBase, borderRight: `1px solid ${TS_DESIGN.border}` }}>
                  <textarea
                    value={row.section}
                    onChange={(e) => updateScoreRow(idx, { section: e.target.value })}
                    onKeyDown={(e) => onCellKeyDown(e, "section")}
                    rows={Math.max(1, row.section.split("\n").length)}
                    className="w-full bg-transparent outline-none resize-none text-center"
                    style={{ color: TS_DESIGN.text, fontSize: 13, lineHeight: 1.5, minHeight: 28, padding: "4px 6px", border: 0, fontFamily: "inherit" }}
                    data-testid={`score-section-${idx}`}
                  />
                </label>
                <label style={{ ...cellBase, borderRight: `1px solid ${TS_DESIGN.border}` }}>
                  <textarea
                    value={row.bars}
                    onChange={(e) => updateScoreRow(idx, { bars: e.target.value })}
                    onKeyDown={(e) => onCellKeyDown(e, "bars")}
                    rows={Math.max(1, row.bars.split("\n").length)}
                    className="w-full bg-transparent outline-none resize-none text-center"
                    style={{ color: TS_DESIGN.text, fontSize: 13, lineHeight: 1.5, minHeight: 28, padding: "4px 4px", border: 0, fontFamily: "inherit" }}
                    data-testid={`score-bars-${idx}`}
                  />
                </label>
                <label style={cellBase}>
                  <textarea
                    value={row.lyric}
                    onChange={(e) => updateScoreRow(idx, { lyric: e.target.value })}
                    onKeyDown={(e) => onCellKeyDown(e, "lyric")}
                    rows={Math.max(1, row.lyric.split("\n").length)}
                    className="w-full bg-transparent outline-none resize-none text-left"
                    style={{ color: TS_DESIGN.text, fontSize: 13, lineHeight: 1.5, minHeight: 28, padding: "4px 10px", border: 0, fontFamily: "inherit" }}
                    data-testid={`score-lyric-${idx}`}
                  />
                </label>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
