// 譜割タブの scoreRows（手入力データ）から SECTION ブロックを派生させるユーティリティ。
//
// scoreRows の各行を順に走査し、SECTION 名が現れた位置から次の SECTION 名（または曲末尾）
// までを 1 ブロックとして扱う。bars 列の数字を累積して開始小節 / 終了小節を計算する。
//
// 入力データには一切書き戻さない。読み取り専用の派生処理。

export type ScoreRowLike = { id: string; section: string; bars: string; lyric: string };
export type SectionBlockLike = { id: string; label: string; startBar: number; endBar: number };

export function deriveBlocksFromScoreRows(scoreRows: ScoreRowLike[] | undefined): SectionBlockLike[] {
  if (!scoreRows || scoreRows.length === 0) return [];
  const result: SectionBlockLike[] = [];
  let cumBars = 0;
  let current: SectionBlockLike | null = null;
  for (const row of scoreRows) {
    const secLines = row.section.split("\n");
    const barLines = row.bars.split("\n");
    const maxLines = Math.max(secLines.length, barLines.length);
    for (let i = 0; i < maxLines; i++) {
      const label = (secLines[i] || "").trim();
      if (label) {
        if (current) {
          current.endBar = cumBars;
          if (current.endBar > current.startBar) result.push(current);
        }
        current = { id: `derived-${row.id}-${i}`, label, startBar: cumBars, endBar: cumBars };
      }
      const barText = barLines[i] || "";
      const nums = barText.match(/\d+/g) || [];
      const barSum = nums.reduce((s, n) => s + parseInt(n, 10), 0);
      cumBars += barSum;
    }
  }
  if (current) {
    current.endBar = cumBars;
    if (current.endBar > current.startBar) result.push(current);
  }
  return result;
}
