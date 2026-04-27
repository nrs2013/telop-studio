// SECTION ブロックの追加操作。R キー押下、ダブルクリック、+ 追加ボタンから共通で使う。
//
// ルール（のむさん合意）：
//   1. 指定位置（atBar）に「NEW」ラベルで preferredLen 小節（既定 1 小節）の SECTION を追加
//   2. atBar が他ブロックの範囲内なら、そのブロックの右端を新しい起点とする（はみ出さない）
//   3. 追加位置から右方向に preferredLen 分の空きがなければ、空き分だけ短くする（最低 0.25 小節）
//   4. 0.25 小節も入る空きがなければ追加しない（null を返す）

export type SectionBlockLite = { id: string; label: string; startBar: number; endBar: number };

const MIN_LEN = 0.25;

/** 指定位置 atBar に SECTION ブロックを追加した新しい配列を返す。
 *  追加できなかった場合は null。 */
export function addSectionBlockAt(
  blocks: SectionBlockLite[],
  atBar: number,
  preferredLen: number = 1,
): SectionBlockLite[] | null {
  let pos = Math.max(0, atBar);

  // atBar が既存ブロックの内側に落ちていたら、そのブロックの右端を起点にする
  for (const b of blocks) {
    if (pos >= b.startBar && pos < b.endBar) {
      pos = b.endBar;
    }
  }

  // pos から右にある最も近いブロックの startBar を探す（=右側の壁）
  let nextStart = Infinity;
  for (const b of blocks) {
    if (b.startBar > pos - 0.0001 && b.startBar < nextStart) {
      nextStart = b.startBar;
    }
  }

  const available = nextStart - pos;
  if (available < MIN_LEN) return null;

  const len = Math.min(preferredLen, available);
  const id = `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  return [...blocks, { id, label: "NEW", startBar: pos, endBar: pos + len }];
}
