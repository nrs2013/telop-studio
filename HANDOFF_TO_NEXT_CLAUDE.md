# TELOP STUDIO — 次の Claude への引き継ぎ

最終更新: 2026-04-25
担当ユーザー: のむさん（コンサート演出家・コード未経験 / GitHub: `nrs2013`）

---

## ⚡ まずこれを読む（次の Claude へ）

1. **のむさんはコード未経験**。エンジニア用語でなく舞台用語・日本語で噛み砕いて説明する
2. **ターミナルコマンドはコピペできる完成形で渡す**（パス省略・改行ぐちゃぐちゃ厳禁）
3. 必ず以下のスキルを最初に読み込む：
   - `concert-app-deploy` スキル（TELOP STUDIO ops セクションあり）
   - `concert-video-export` スキル（`references/vp9-alpha-webm.md` あり）
4. のむさんは **アプリは沢山作りたいが、コードは全くわからない** という前提
5. 効率重視。無駄話は嫌う。**Resolume Arena (VJ)** に強い関心

---

## 🚨 緊急：未 push のコミットが 2 本ある

```
493f637 fix(preview): make wrapper aspect-fit so the canvas has no internal letterbox
90bb2b9 fix(preview): blend the aspect-ratio letterbox into the editor background
```

両方とも `client/src/pages/project.tsx` 1 ファイルだけの変更。
Railway 本番に反映するため、のむさんに以下のコマンドをコピペして実行してもらう必要がある：

```bash
cd ~/Projects/telop-studio
git push
```

**もし `rejected` 系のエラーが出たら：**

```bash
cd ~/Projects/telop-studio
git pull --rebase
git push
```

push が成功すると Railway が自動でデプロイし直し、本番（https://telop-studio-production.up.railway.app/）に 2〜3 分で反映される。

---

## 🎯 今セッションで解決した課題（履歴）

### A. VP9 + alpha (透過) 書き出しの「壊れていた」騒動 → 実は壊れていなかった
- **症状**: 過去 Claude が「alpha が落ちている」と言って大改造祭りを開始
- **真相**: ffmpeg のデフォルトデコーダ `vp9` は BlockAdditional を読まない。`-c:v libvpx-vp9` を強制すると正しく alpha が読める
- **検証方法**: `ffmpeg -c:v libvpx-vp9 -i in.webm -map 0:v:0+lavfi -filter_complex "alphaextract,signalstats" -f null -` で YAVG を測定
- **書き出し速度**: `threads=4 cpu-used=5 row-mt=1 tile-columns=2` で約 43% 高速化済み（commit 645dcc7）

### B. Dropbox 曲リンクの誤マッチ事故（部下が触って発覚）
- **症状**: 「OPENING」と検索すると `DXTEEN_OPENING_MIX.wav` に勝手にリンクされてしまう
- **原因**: サーバー側の `/api/dropbox/find` が `String.includes()` で部分一致していた
- **対応**: `server/dropboxMatch.ts` に純粋関数として切り出し、NFC 正規化 + 拡張子無視の **完全一致のみ** に。`unique` / `ambiguous` / `none` の 3 状態を返す
- **テスト**: `server/dropboxMatch.test.ts`（25件）+ `server/dropboxFindSim.test.ts`（18件）= 43件 全パス
- **テスト走らせ方**: `npx tsx server/dropboxMatch.test.ts` / `npx tsx server/dropboxFindSim.test.ts`

### C. .telop インポート時の `imported_audio.mp3` プレースホルダ問題
- **症状**: .telop を取り込むと曲名が `imported_audio.mp3` 固定になり、Dropbox 検索でヒットしなくなる
- **対応 3 層**:
  1. **エクスポート側** (`project.tsx`): `.telop` 出力に `audioFileName` を含める（top-level + project ブロック内）
  2. **インポート側** (`home.tsx`): `audioFileName` または `songTitle` または `name` を優先して採用
  3. **実行時フィルタ**: `loadTrack` で `PLACEHOLDER_NAME_RE = /^imported_audio(\.\w+)?$/i` をスキップして `track.fileName → songTitle → project.name` の順で検索

### D. 手動リンクが 1 分後に勝手に元の曲に戻る競合
- **症状**: 部下が手動でリンクし直すと、約 1 分後に autoSync が古いデータで上書きしてくる
- **原因**: `syncService.ts` の `pullAll` が audio_tracks を無条件 upsert していた
- **対応**: `dirtyProjects` の Set に入っているプロジェクトの音源は触らない & `markDirty(id)` + `schedulePush(id)` を 6 箇所のリンク変更点すべてに付与

### E. UI の warm-gray + 黄色リブランド（PROMPTER STUDIO ライク）
- **新規ファイル**: `client/src/lib/designTokens.ts` の `TS_DESIGN`
- **Login**: `App.tsx` の `LoginScreen` を再構築済
- **Home**: `home.tsx` 全色を `hsl(0 0% N%)` から `TS_DESIGN` トークンに置換済
- **Project ページ内部はまだ未着手**（dark/near-black のまま）→ 次の課題候補

### F. 直前のタスク：Project ページの Preview 余白問題（**今セッション最後に対応**）
- **症状**: プレビュー画面の左右に黒い余白が出る（"このチェッカーの横の黒い部分を無くしたい"）
- **第 1 回（不採用・cosmetic）**: wrapper bg を `#000000` → `#262624` に。のむさんは「まだ黒い」とリジェクト → commit 90bb2b9
- **第 2 回（structural・採用）**: wrapper を 2 層に分割 → commit 493f637
  - 外側 = `flex-1` + 透明背景 + ResizeObserver で利用可能領域を測定
  - 内側 = `previewSize.width × previewSize.height` で明示的にサイズ指定 → **内側の余白がゼロ**
  - 余白はエディタクローム色（hsl(0 0% 4%)）にシームレスに溶け込む
- **位置**: `client/src/pages/project.tsx` L5224 付近
- **要確認**: のむさんが本番デプロイ後に確認 → それでも気になるなら「キャンバス出力サイズを画面に合わせて変える」など別アプローチに進む

---

## 🛠 主要ファイル早見表

| ファイル | 役割 |
|---|---|
| `server/routes.ts` | API ルート全部。`/api/dropbox/find`, `/api/dropbox/download`（ffmpeg ストリーム）、`/api/diag/alpha-selftest` |
| `server/dropboxMatch.ts` | 厳密一致マッチング（純粋関数） |
| `server/dropbox.ts` | `downloadFromDropboxStream()`（ストリーム）と `downloadFromDropbox()`（バッファ）両方持つ |
| `server/alphaDiag.ts` / `alphaEncode.ts` | Alpha 検証 + 二本立て予備エンコーダ |
| `client/src/lib/designTokens.ts` | `TS_DESIGN` カラートークン |
| `client/src/lib/syncService.ts` | dirtyProjects + autoSync + push |
| `client/src/pages/project.tsx` | エディタ本体（5,500 行超）。preview wrapper は L5224 付近 |
| `client/src/pages/home.tsx` | 曲リスト + .telop インポート |
| `Dockerfile` | `node:22-trixie-slim` + apt の ffmpeg 7.1 |

---

## 🔑 環境・運用情報

- **本番 URL**: https://telop-studio-production.up.railway.app/
- **GitHub**: nrs2013/telop-studio
- **デプロイ**: Railway（Dockerfile ベース、main push で自動デプロイ）
- **DB**: Supabase Postgres（Drizzle ORM 経由）
- **ローカル DB**: IndexedDB（dexie）
- **のむさん Mac 上のパス**: `~/Projects/telop-studio`
- **Cowork から見た同パス**: `/sessions/lucid-exciting-sagan/mnt/telop-studio`

---

## 📝 のむさんとのやり取りで気をつけること

- **コード用語禁止**：「リファクタ」「リポジトリ」「コミット」など極力使わず、舞台用語に置き換える
- **コマンド渡し**：必ず `cd ~/Projects/telop-studio` から始まる完成形で。途中の説明より「まずコピペして」が好まれる
- **失敗の説明**：「赤い文字が出ました」とスクショで来ることが多い。慌てず読む
- **意思決定**：技術の話は提示しすぎず、選択肢を 2〜3 個に絞ってから「どっちにする？」と聞く
- **AskUserQuestion ツール**：選択肢付き質問に最適

---

## ⏭ このあとやりたいかもしれないこと（候補）

- Project ページ内部の warm-gray 化（toolbar / panels も TS_DESIGN に揃える）
- 出力解像度プリセットを画面サイズに自動合わせる UI（letterbox 問題の根本解決）
- VP9 + alpha 書き出し速度のさらなる短縮（GPU エンコード？）
- プレビューの背景チェッカーを TELOP brand 色に
- .telop のスキーマ v2 化（後方互換 import）

---

## 🆘 困ったとき

- VP9+alpha の検証コマンド: `concert-video-export` skill 内 `references/vp9-alpha-webm.md`
- デプロイ詰まり: `concert-app-deploy` skill 内 TELOP STUDIO ops セクション
- Dropbox マッチング仕様: `server/dropboxMatch.ts` 冒頭コメント + テストファイル

---

## 🧭 現在の git 状態（2026-04-25 時点）

```
On branch main
Your branch is ahead of 'origin/main' by 2 commits.
  493f637 fix(preview): make wrapper aspect-fit so the canvas has no internal letterbox
  90bb2b9 fix(preview): blend the aspect-ratio letterbox into the editor background
```

→ のむさんに `git push` をコピペしてもらえばそれで反映完了。

---

**のむさんからの直近メッセージ**: 「このチャットも重くなったので、引き継ぎを作って」

→ この HANDOFF が完成版。次の Claude はまずこのファイルを冒頭から読んで、それから関連スキルを読み、未 push の 2 commit を Railway に反映するところから始める。
