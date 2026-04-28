# TELOP STUDIO — 次の Claude への引き継ぎ

最終更新: 2026-04-28
担当ユーザー: のむさん（コンサート演出家・コード未経験 / GitHub: `nrs2013`）
本番 URL: https://telop-studio-production.up.railway.app/
リポジトリ: `~/Projects/telop-studio`（Mac ローカル） / GitHub: `nrs2013/telop-studio`
デプロイ: Railway（main に push で自動デプロイ）

---

## ⚡ 絶対に最初に読む（順番に必ず）

1. **のむさんはコード未経験。エンジニア用語は使わない。** 舞台用語・日本語で噛み砕く。
2. **`DATA_SAFETY_RULES.md` を必ず読むこと。** ユーザーデータ破壊事故の経緯と禁止事項。
3. **指示は文字通りやる。解釈で広げない。** 思いついたアイデアは「提案として書く」、勝手に作らない。
4. **「確認しろ」と言われたら触るだけ。** 1 行も足さない引かない。
5. **ターミナルコマンドはコピペできる完成形で渡す。**
6. **解釈に揺れがあれば必ず聞く。** 推測で進めない。
7. **大きな機能を作る前は、必ずモック（HTML/SVG）で見せて承認を取る。**
8. **巻き戻しを頼まれたら、ステップ単位で慎重に進める。** 一気にやって壊さない。

---

## 🚨 サンドボックスのロックファイル問題（毎回発生）

git commit / push を Claude が実行すると `.git/index.lock` などが残る。
サンドボックスは unlink を許可してないので、サンドボックス側からは消せない。

**解決方法**：のむさんに毎回これを Mac ターミナルで実行してもらう：
```
cd ~/Projects/telop-studio && rm -f .git/index.lock .git/HEAD.lock .git/refs/remotes/origin/main.lock .git/objects/maintenance.lock
```

エイリアス設定はのむさんが「面倒」と却下。手動運用継続。

push 時のテンプレ：
```
cd ~/Projects/telop-studio && rm -f .git/index.lock .git/HEAD.lock .git/refs/remotes/origin/main.lock .git/objects/maintenance.lock && git add <files> && git commit -m "<message>" && git push origin main
```

---

## 📍 現在の状態（2026-04-28 セッション終了時点）

### 直近の作業
**TITLE トレースアニメ（Keynote 風の手書きアニメ）を試みた → 全部巻き戻し済み。**

- Canvas clip 方式 → モックの「ペン先で書く」感じが出ない
- SVG オーバーレイ + stroke-dasharray 方式 → 完璧再現には opentype.js + フォント TTF/OTF 必要
- GitHub LFS 経由でフォント取得失敗（HTML が返ってきた、305KB の不正ファイル）
- のむさん判断で**全部巻き戻し**決定 → 7 ステップで完了

### 巻き戻し内容（全て完了）
- `client/src/pages/project.tsx` の `drawStrokeTextInline` を元の strokeText + fillText に戻し
- `chStrokeP` / `chFillP` のタイミングを `* 0.7 / * 0.5` に戻し（layout=1, layout=2 両方）
- `client/src/components/export-dialog.tsx` も同様に巻き戻し
- SVG オーバーレイ要素・`titleSvgGroupRef`・`titleSvgTextRef`・`USE_SVG_TITLE_ANIM` 定数を全て撤去
- 描画ループ冒頭の SVG hide コードも撤去
- `vite build` 成功確認済み（`✓ built in 4.65s`）

### push 状況
**まだ push されていない可能性が高い。** のむさんに以下のコマンドを渡す必要あり：
```
cd ~/Projects/telop-studio && rm -f .git/index.lock .git/HEAD.lock .git/refs/remotes/origin/main.lock .git/objects/maintenance.lock && git add client/src/pages/project.tsx client/src/components/export-dialog.tsx && git commit -m "revert(credit): TITLE トレース作業を全部巻き戻し（drawStrokeTextInline・タイミング・SVG オーバーレイすべて元に）" && git push origin main
```

### `public/fonts/NotoSerifJP-Bold.otf` の扱い
GitHub LFS 越しに取ろうとして HTML（305KB）が降ってきた状態のファイルが残っている可能性。
**使っていないので無視 OK。** 必要になったら正しい OTF/TTF を別途取得する（後述）。

---

## 🎯 今までに完成した機能（全部生きてる）

### 1. リハーサルマーク（SECTION ブロック）
- タイムライン上部の SECTION 帯にドラッグ可能なブロック
- 重なり防止クランプ（`wallBlocks` + linked 連動、mode `"left"` / `"right"` / `"move"`）
- snap = `Math.round(bar * 4) / 4`（1 拍単位）、Alt 押下で 1/256
- 黄色×グレー交互カラー（`positionIndex` by `startBar`）
- データキー：`telop-sections-v1-{projectId}`
- 削除：選択 + Delete（譜割モード時のみ）
- 追加：R キー / ダブルクリック（再生位置に 1 小節分）
- ロジック：`client/src/lib/sectionBlockOps.ts` の `addSectionBlockAt`

### 2. 譜割タブ（右パネル）— 完全自動生成・読み取り専用
- 4 列：TIME | SECTION | BAR | LYRIC
- `gridTemplateColumns: "56px 64px 64px 1fr"`
- タイムラインの SECTION ブロック + TELOP データから自動構築
- 中央時刻判定：`(l.startTime + l.endTime) / 2 が SECTION 範囲内か`
- BAR トークン：4 / 2 / 1 / 1/4 の小節パターン
- `barByRow`：各 BAR トークンを歌詞行の縦位置にマッピング
- 再生位置ハイライト：`color: "#ffd34d"`（背景なし、太字なし）
- ファイル：`client/src/components/score-panel.tsx`

### 3. SAMPLER パネル（右端 180px）
- リハーサルマークから自動でボタン生成
- クリック → 該当 SECTION の **2 小節前から再生**
- 再生中は該当ボタンが黄色く光る（追従）
- ファイル：`client/src/components/sampler-panel.tsx`

### 4. TITLE クレジット（CITE / SUB / TITLE A / TITLE B）
- TITLE A IN アニメ：`inAnimScale = creditHoldStartMs / 素のIN所要時間` で帯の幅から逆算
- TITLE B 帯と rt アニメ完了タイミング統一：`100/500`
- データ加工なし、既存挙動維持

### 5. タブ UI（D 案セグメンテッド）
- LYRIC / 譜割 タブ：高さ 40、padding `5px 36px`
- 黄色フレーム連続（タブ + コンテンツを 1 つの親 div で囲む）
- `whiteSpace: "nowrap"`
- フォーカスリング除去：`outline: "none"` + `focus:outline-none`
- SHORTCUT はヘッダーへ移動

### 6. 編集モード切替
- `editMode = activeRightTab`（"lyrics" | "score"）
- LYRIC 時：歌詞ブロックを編集可能、SECTION 帯 opacity 0.35
- 譜割時：歌詞ブロックを `data-edit-mode="score"` で CSS ロック、SECTION 帯フル操作
- TITLE バー群を `<div data-credit-bar-group>` で囲って譜割モード時ロック

### 7. タイムライン左ラベル
- T / R / A の 3 段ラベル列に分割

### 8. dead code 撤去（完了）
- `client/src/hooks/useScoreFullText.ts` ❌ 削除
- `client/src/hooks/useScoreBarOverrides.ts` ❌ 削除
- `client/src/hooks/useScoreRows.ts` ❌ 削除
- `client/src/hooks/useLyricOverrides.ts` ❌ 削除
- `client/src/lib/sectionBlockDerivation.ts` ❌ 削除
- 関連 import / props も撤去済み
- SAMPLER と timeline-editor から `scoreRows` fallback も撤去

### 9. その他細かい
- 「+追加」ボタン削除
- ヒント文削除
- SET BAR 1 ボタン削除
- 再生中 SECTION ブロックの位置ズレ修正（`Math.max(0, x)` 削除）
- 再生ヘッド `z-40`

---

## ⚠️ 進めかけて却下された機能（再導入禁止）

1. **譜割タブの行ハイライト（背景色）** — 全部光って見える、却下
2. **譜割タブの文字ハイライト（黄色文字、太字）** — 却下
3. **タイムライン 3 段同高（リハーサル/TELOP/AUDIO 各 38px）** — バランス悪い、却下
4. **タイムラインツールバーの [LYRIC] [譜割] タブ** — 右パネルのタブで連動するように変更
5. **TITLE トレースアニメ（Keynote 風）** — モックと違う動きにしかならず巻き戻し
   - もし将来再挑戦するなら、**opentype.js + 正規の OTF/TTF フォントファイル必須**
   - GitHub LFS 経由で取らない（HTML が返る）→ Google Fonts から直接落とす
   - SVG オーバーレイ方式で `getTotalLength` + `stroke-dasharray` を使う
   - **EXPORT 側も同じ方式で揃える必要がある**
6. **fullText 方式の譜割（手入力）** — 古い構成のまま保存される事故が起きた、撤去済み

---

## 🔮 未着手 / 進行可能な次のタスク

### A. SECTION ブロックの名前インライン編集
- 現状：`prompt()` ベースのダイアログ
- 希望：クリックで `<input>` に切り替わるインライン編集
- 「AK1」として開始したが TITLE トレース騒動で中断、stash 状態で削除済み
- 再着手時はゼロから

### B. BPM 検知の世界最高峰化
- `BPM_WORLD_CLASS_PLAN.md` 参照
- Beat This! 採用予定
- フェーズ 2：のむさんから「ズレる曲」サンプル mp3 をもらって PoC

### C. Dropbox 連携（保留中、のむさんの部下が再リンク中）

### D. TITLE トレースアニメ（再挑戦するなら）
- opentype.js を使ってフォントから path 抽出
- SVG `<path>` で `stroke-dasharray` + `stroke-dashoffset` アニメ
- Canvas EXPORT も同じ方式に揃える（rasterize SVG → Canvas）
- フォントは Google Fonts から直接 OTF/TTF を取る（LFS 経由禁止）

---

## 💬 コミュニケーションの注意点

- のむさんは**極端に時間がない**。長文の説明は嫌う。
- ロックファイルを毎回ユーザーに消してもらう必要がある（諦めて受け入れた）
- 失敗・誤解釈には**正直に謝る**、ただし self-abasing にはならない
- 「もう一回最初から」と言われたら、**勝手にコードを書き換えず**、まず仕様の再確認から
- 過去のセッションで Claude が**仕様外の機能を勝手に作って**何時間も無駄にした実績あり
- **API エラー / 重くなったら早めに区切る判断をする**（context 爆発の前に引き継ぎを作る）
- **「ゆっくり確実に進めて」と言われたらステップ単位で確認しながら進める**

---

## 🗂 主要ファイル

- `client/src/pages/project.tsx` — 6500 行超、エディタ本体（state、譜割タブ、SAMPLER、TimelineEditor へのプロパティ、TITLE 描画）
- `client/src/components/timeline-editor.tsx` — 3000 行超、タイムライン本体（ruler、blocks、waveform、SECTION 帯、ドラッグ可能な SECTION ブロック、TITLE バー群）
- `client/src/components/score-panel.tsx` — 譜割タブ（4 列スプレッドシート、完全自動生成）
- `client/src/components/sampler-panel.tsx` — SAMPLER（リハーサルマークから自動生成、追従ハイライト）
- `client/src/components/export-dialog.tsx` — EXPORT ダイアログ（mp4 書き出し、Canvas で TITLE / 歌詞描画）
- `client/src/lib/sectionBlockOps.ts` — SECTION ブロック追加（`addSectionBlockAt`）
- `client/src/lib/designTokens.ts` — `TS_DESIGN`（色、border、bg2 等）
- `shared/schema.ts` — DB スキーマ（projects, lyrics, audio）

### 必読ドキュメント
- `DATA_SAFETY_RULES.md` — **絶対必読**、データ加工・既存キー上書き・マイグレーション全禁止
- `BPM_WORLD_CLASS_PLAN.md` — BPM 改善計画
- `MASTER_PLAN_HUB.md` — 中央ハブ計画

---

## 🛠 環境メモ（サンドボックス vs Mac 側）

### Claude（サンドボックス）でできること
- ファイルの Read / Write / Edit（`/Users/nomurayuuki/Projects/telop-studio/` 経由）
- `vite build` の確認（bash 経由）
- `git status` / `git log` / `git diff`（読み取り）

### Claude（サンドボックス）でできないこと
- `.git/index.lock` の削除（unlink 拒否）
- 確実な `git push`（lock が残ると次回詰む）

### のむさん（Mac ターミナル）に頼むこと
- ロックファイル削除 + commit + push（前述のテンプレ）
- Mac でしか動かないコマンド（macOS specific）

### 重要な path 対応
- Mac: `/Users/nomurayuuki/Projects/telop-studio/`
- Sandbox bash: `/sessions/hopeful-friendly-dijkstra/mnt/telop-studio/`
- 同じファイル、同じ内容、別 path

---

## 🧠 重要な技術的決定（覚えておくべき）

### データモデル
- **`telop-sections-v1-{projectId}`**: SECTION ブロック（時間ベース、リハーサルマーク）
- **`telop-lyrics-v3-{projectId}`**: 歌詞ブロック
- **既存キーは絶対に上書きしない**（DATA_SAFETY_RULES.md）

### inAnimScale（TITLE A の IN アニメ時間調整）
- TITLE A の IN アニメ所要時間を、TITLE A 帯の幅（`creditHoldStartMs`）から逆算
- `inAnimScale = creditHoldStartMs / 素のIN所要時間`
- これにより、帯を縮めても伸ばしても、IN アニメは帯の幅にぴったり収まる

### SECTION snap
- 通常：1 拍（1/4 小節）= `Math.round(bar * 4) / 4`
- Alt 押下：1/256
- 1/16 だと半端値が伝染するので 1 拍に変更した経緯あり

### 編集モード（`editMode`）
- `"lyrics"`：歌詞編集可能、SECTION 帯フェード（opacity 0.35）
- `"score"`：歌詞ブロックロック（CSS）、SECTION 帯フル操作可能
- 切替トリガー：右パネルの LYRIC / 譜割 タブ

### キーマップ
- **R**：再生位置にリハーサルマーク追加（1 小節分）
- **ダブルクリック（タイムライン SECTION 帯）**：同上
- **Delete**：譜割モード時、選択中の SECTION ブロック削除
- **IME 変換中はショートカット無効**

### stale closure 回避
- `handleKeyDown` の useEffect が空依存配列だと stale closure 発生
- 解決：`sectionBlocksRef.current` / `effectiveSectionBlocksRef.current` を使う
- パターン：「ref を useRef で保持し、useEffect で `.current` を更新、handler は `.current` を読む」

---

## 🔥 過去の事故・教訓

1. **fullText 方式の譜割で、古い構成のまま保存されて歌詞が間違った SECTION に入る** → 完全自動生成化
2. **`Math.max(0, x)` クランプで再生中 SECTION ブロックがズレる** → 削除して素の `x` を使う
3. **`vite build` を確認せずに push して本番が壊れる** → push 前に必ずビルド確認
4. **TITLE トレースアニメで何時間もかけて巻き戻し** → 大きな機能はモック先、承認先
5. **Claude が仕様外の機能を勝手に作って何時間も無駄にした** → 文字通りやる、解釈で広げない

---

## 🎯 引き継ぎ完了時点でのアプリの状態

- TITLE トレース作業は**全て巻き戻し済み**（`vite build` 成功確認済）
- ただし**未 push の可能性が高い**（push コマンドはのむさんに渡してある）
- 譜割タブ、SECTION ブロック、SAMPLER、編集モード切替、すべて完成して動いている
- データ破壊なし、既存挙動維持

**事故の教訓を風化させないこと。**
