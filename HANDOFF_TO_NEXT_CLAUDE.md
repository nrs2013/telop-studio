# TELOP STUDIO — 次の Claude への引き継ぎ

最終更新: 2026-05-02
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

## 📍 現在の状態（2026-04-29 セッション終了時点）

### 直近の作業

3 つの機能追加 + 1 つの大きな機能を実装→全削除（巻き戻し）。

#### 完成・push 済み（生きてる）

**1. リハーサルマークのインライン名前編集**（commit `95c33ac`）
- `prompt()` ダイアログを廃止、ブロック上で直接 `<input>` でタイプ
- Enter または外クリックで確定、Esc でキャンセル、空文字ならキャンセル扱い
- 編集中はドラッグ・選択切替が起きないよう `mouseDown` 抑制
- 場所：`client/src/components/timeline-editor.tsx` の SECTION ブロック描画部
- state は `editingSectionId`（local state）

**2. 譜割タブの 4 列を太さ・色とも統一**（commit `7c916dc`）
- SECTION 列だけ太字（`fontWeight: 500`）＆グレー（`hsl(0 0% 75%)`）だったのを撤去
- TIME / SECTION / BAR / LYRIC を全て同じ細め（標準）＋ LYRIC の `TS_DESIGN.text` 色に統一
- 再生位置の黄色ハイライト（`#ffd34d`）はそのまま維持
- 場所：`client/src/components/score-panel.tsx`

**3. imported_audio 自動リネーム**（commit `15843e9` + 修正 `24be1b4`）
- プロジェクトを開いた瞬間、`audioFileName` が `imported_audio` 系だったら
  `project.songTitle` または `project.name` で**サイレントリネーム**
- 元値は localStorage の `telop-audio-original-{projectId}-{ISO日時}` にバックアップ
- **重要修正（`24be1b4`）**：当初 `handleRenameAudioFile` を呼んでたが、Dropbox API 失敗時に
  早期 return → ローカル state が更新されずトーストだけ出る不整合発生（2026-04-29 観測）
- → 修正後：**Dropbox 同期は完全スキップ**、`storage.renameAudioTrackFile` でローカル＋サーバー sync のみ更新
- → Dropbox 上のファイル名は手動で**鉛筆ボタン**から同期する運用
- 場所：`client/src/pages/project.tsx` 1842 行〜（`autoRenameAttemptedRef` で 1 セッション内 1 回試行）
- 同じプロジェクトに対して `attemptKey = ${projectId}:${currentName}:${candidate}` で重複防止

#### 実装→全巻き戻し（commit `68d3812` 追加 → `b76fe04` で全削除）

**CAST モード（OBS / NDI 経由で本物のアルファ付きで Resolume Arena に送出）** を実装したが、
複雑性のコスト > メリットで**のむさん判断で全削除**した。

技術的には**全パスが動作確認済み**（重要な学び）：

```
TELOP STUDIO（?mode=cast、透過 Canvas、UI 全部隠し）
   ↓ ブラウザ
OBS Browser Source（カスタム CSS の body transparent）
   ↓ プラグイン
DistroAV（NDI plugin、OBS 32+ 標準じゃない、`obs-syphon-server` 系プラグインは
         OBS 32.x で動作報告不安定。DistroAV は活発にメンテされてる）
   ↓ NDI 5.x
libNDI for Mac Runtime（https://distroav.org/ndi/redist-macos）
   ↓ NDI ネットワーク
Resolume Arena 7.24.2（NDI Source 検索で `MAC.INTERNAL2 (OBS PGM)`）
   ↓ Alpha Type: Straight
Composition Monitor に文字だけ浮く（背景は VJ 映像が透過、本物のアルファ）✓
```

**巻き戻しの理由（次回参照用）：**
- OBS の**起動が必須**（OBS WebSocket API も OBS 起動が前提）
- Browser Source は独立 Chromium → メイン Chrome と Cookie が別 → 毎回ログイン必要
- libNDI ランタイムも別途インストール必須（Gatekeeper の `xattr -c` 警告解除も必要）
- 本番運用フローが**4 ピースで複雑**（メインタブ ＋ CAST タブ ＋ OBS ＋ Arena）
- DistroAV 起動時の警告ダイアログ「NDI Runtime not found」など、地味なつまづきが多い

**次回 OBS なしのルートで再挑戦するなら（候補）：**
1. **TELOP STUDIO を Electron アプリ化**して NDI / Syphon を直接吐く（理想形・大工事）
2. **Splash Pro** 系の軽量「ブラウザ → Syphon/NDI 専用ツール」を使う（有料）
3. **OBS 仮想カメラ + Arena Webcam Source + クロマキー黒抜き**（疑似アルファ、即動作）
   - macOS の Camera Extension 許可が必要（Touch ID 入力）
4. **ウィンドウキャプチャ + macOS スクリーンキャプチャ**で Chrome タブを直取り
   - サブディスプレイ運用必須

**学び：**
- 「真のアルファ × リアルタイム × Arena 連携」は技術的に可能、ただし環境構築コストが大きい
- 現場ですぐ使うなら**事前 MP4 書き出し（HAP Q Alpha） → Arena でクリップ再生**が最強の運用安定度
- 引き継ぎファイル経由で別 Mac でも作業引き継ぎできる前提（Cowork セッション自体はローカル保存）

### push 状況
全 4 commit push 済み（HEAD = `24be1b4`）。Railway 本番に反映済み。

### 補足：のむさん側の Mac 環境
今日のセッションで OBS / DistroAV / 関連 pkg は**ゴミ箱送り＋設定削除済み**。
- `/Applications/OBS.app` → Trash
- `~/Library/Application\ Support/obs-studio` 削除
- `~/Library/Caches/com.obsproject.obs-studio` 削除
- `~/Downloads/distroav*.pkg`、`libNDI_for_Mac.pkg` 削除
- libNDI ランタイム（`/usr/local/lib/libndi*.dylib`）は**残ってる**（実害なし、他アプリで使う可能性あるため）

---

## 🛡 2026-05-02 パトロール（しばらく触ってなかったので全件確認）

のむさん依頼で「隅々まで見直して問題ないかパトロール」を実施。結果：

### ✅ 問題なし
- vite build 成功
- 本番デプロイ済み
- DATA_SAFETY_RULES 遵守：`localStorage.setItem` 使用箇所はすべて安全（ユーザー操作起点 or バックアップ用新規キー）
- CAST モード巻き戻しの残骸ゼロ
- 既存機能はすべて影響なし

### 🧹 片づけたもの（commit `3b479f3`）
- **dead code 4 hook を完全削除**（前回引き継ぎ「dead code 撤去（完了）」と書いたが実は実体ファイルが残ってたのを今度こそ完全削除）
  - `useScoreRows.ts` / `useScoreFullText.ts`（過去のデータ破壊事故元）/ `useScoreBarOverrides.ts` / `useLyricOverrides.ts`
  - 291 行削減
- **ローカルゴミ整理**
  - `public/fonts/NotoSerifJP-Bold.otf`（GitHub LFS から HTML が降ってきた 305KB の不正ファイル）削除
  - `DEMO_timeline_score*.html` 2 ファイル削除

### ⚠️ 既知の宿題として残ってる（実害低・次回以降で OK）

- **`bpmDetect.ts` 526 行のスコープバグ**：`resolveOctaveErrors` 関数の引数に `channelData` と `sampleRate` が宣言されてないのに本文で使ってる（TS2304 エラー、ビルドは通る）
  - 実害：`refineBPMByKickMatch` の最初の `if (!channelData || !sampleRate || !roughBpm) return roughBpm;` ガードで早期 return → rough BPM がそのまま返る
  - **ステージ 2 の BPM 精密化が事実上動いてない**状態
  - 引き継ぎの「未着手タスク B：BPM 検知の世界最高峰化」と関連する宿題
- **`timeline-editor.tsx` 3682, 3813**：`origTime: number` に `effectiveCreditIn`（`number | null`）が入る可能性。null の場合 NaN ドラッグ懸念だが、後続のガードで弾かれてる（実害低）
- **その他の既存型エラー（9 件）**：`Map iteration` の TS2802（`--target` 警告）、`server/alphaEncode.ts` の BigInt literal 警告、`undo`/`redo` の戻り値 `string | null` vs `string | undefined` の差など。ビルドは通っており実害は低い

---

## 📍 過去のセッション（2026-04-28 セッション終了時点）

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
7. **CAST モード（OBS / NDI 経由で Arena に直接送出）** — 2026-04-29 実装→全削除
   - 技術的には完全に動作（Arena に本物のアルファで届くまで実証済み）
   - けれど **複雑性のコスト > メリット** でのむさん判断で巻き戻し
   - 詳細は上の「📍 現在の状態（2026-04-29）」の CAST モード巻き戻しセクション参照
   - **再導入したいなら必ずのむさんに事前確認**（コストの再認識を促す）。
     より良い候補：Electron 化、Splash Pro 系、仮想カメラ + クロマキー

---

## 🔮 未着手 / 進行可能な次のタスク

### A. ~~SECTION ブロックの名前インライン編集~~ ✅ 2026-04-29 完了

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
6. **CAST モード実装（2026-04-29）** → 技術的に動いたが、複雑性のコスト > メリットで巻き戻し
   → 「機能が動くこと」と「のむさんが日常運用したいか」は別問題、事前にコスト見積もる
7. **imported_audio 自動リネームで Dropbox 失敗時の不整合（2026-04-29）** → トーストだけ出て表示更新されない
   → サードパーティ API（Dropbox）への依存はオプション扱いにし、ローカル更新は確実に行う

---

## 🎯 引き継ぎ完了時点でのアプリの状態（2026-04-29）

- 直近 4 commit すべて push 済み（HEAD = `24be1b4`）、Railway 反映済み
- リハーサルマークインライン編集 / 譜割 4 列統一 / imported_audio 自動リネーム → **本番で稼働中**
- CAST モードは**全削除済み**（2026-04-29 実装→巻き戻し、`vite build` 成功確認済）
- 譜割タブ、SECTION ブロック、SAMPLER、編集モード切替、すべて完成して動いている
- データ破壊なし、既存挙動維持
- のむさんの Mac から OBS / DistroAV プラグイン / 関連 pkg は撤去済み

**事故の教訓を風化させないこと。**
