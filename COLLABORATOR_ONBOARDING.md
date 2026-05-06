# 🎬 TELOP STUDIO 共同開発者オンボーディング

このドキュメントは、**のむさん（コンサート演出家・コード未経験）と一緒に TELOP STUDIO を共同開発する人**のための引き継ぎ書です。

想定読者：共同開発者本人 ＋ その人が使う Claude（Cowork mode）セッション。

---

## 📌 まず最初に読むべき 3 つ

順番厳守です。これを読まずにコードに触らないでください。

1. **このファイル** — 全体像と作業ルール
2. **`DATA_SAFETY_RULES.md`** — データ保護の絶対ルール（過去の事故から学んだもの）
3. **`HANDOFF_TO_NEXT_CLAUDE.md`** — これまでの作業履歴・既知の宿題・教訓

---

## 🎯 プロジェクトの概要

### TELOP STUDIO とは

コンサート本番で使う**字幕（テロップ）を作るための Web アプリ**。

- ユーザー：のむさん（コンサート演出家、本人）と現場のテロップオペレーター
- 用途：曲の歌詞・タイミング・TITLE クレジット・SECTION（リハーサルマーク）を編集 → 本番でテロップとして表示
- 本番URL：https://telop-studio-production.up.railway.app/
- リポジトリ：https://github.com/nrs2013/telop-studio
- ローカルパス：`~/Projects/telop-studio`
- デプロイ先：Railway（main に push で自動デプロイ）

### CONCERT STUDIO スイート

TELOP STUDIO は「のむさんスタジオスイート」の 1 つ。最終的には CONCERT STUDIO（親アプリ）の下にぶら下がる構想。

| アプリ | 役割 | URL |
|---|---|---|
| **TELOP STUDIO** | 字幕・歌詞・SECTION 編集（このリポ） | https://telop-studio-production.up.railway.app/ |
| **STAGE STUDIO** | 演出側ビュー（歌割り・ステージ図・CUE・波形） | （未公開、HTML 単体） |
| **COUNT DOWN STUDIO** | MIDI 連動コンサート用カウントダウンタイマー | https://nrs2013.github.io/count-down-studio/ |
| **PROMPTER STUDIO** | 舞台モニタープロンプター | https://nrs2013.github.io/prompter-studio/ |
| **SCHEDULE STUDIO** | ツアー段取り管理（マスター日付バー、Day/Hotel タブ等） | https://nrs2013.github.io/schedule-studio/ |
| **CONCERT STUDIO** | 親アプリ（構想中） | — |

---

## 👤 のむさんとの作業ルール（最重要）

### 1. のむさんはコード未経験

エンジニア用語を**生のまま使わない**。常に**舞台用語に置き換える**。

| ✗ NG（コード用語） | ◯ OK（舞台用語） |
|---|---|
| 「リポジトリに push します」 | 「倉庫にアップロードします」 |
| 「ビルドが落ちてます」 | 「組み立て中にエラーが出てます」 |
| 「コミット」 | 「保存ポイント」 |
| 「依存関係」 | 「部品の繋がり」 |

### 2. 指示は文字通りやる、解釈で広げない

- 思いついたアイデアは「**提案として書く**」、勝手に作らない
- 「確認しろ」と言われたら**触るだけ**、1 行も足さない引かない
- 過去：仕様外の機能を勝手に作って何時間も無駄にした事故あり

### 3. 大きな機能はモック先・承認先

- 100 行を超えるような変更は、**先に SVG / HTML モックや表で見せる**
- のむさんが「OK」と言ってから実装に入る
- 過去：TITLE トレースアニメで承認なしに実装 → 全部巻き戻し

### 4. ターミナルコマンドは「コピペできる完成形」で

- のむさんに値を埋めさせない
- 例：`git add file1 file2` のようにファイル名まで埋める
- 例：commit メッセージも完成形で渡す

### 5. ロックファイル削除を忘れない（毎回必要）

git push 系コマンドの先頭には必ずこれを入れる：

```
rm -f .git/index.lock .git/HEAD.lock .git/refs/remotes/origin/main.lock .git/objects/maintenance.lock
```

サンドボックス側で git 操作すると lock が残って次回詰むため。これは「諦めて受け入れた」運用。

### 6. のむさんは時間がない

- 長文の説明は嫌う
- 表でまとめる、箇条書きを使う
- 結論を先に、根拠を後に

---

## 🛡 DATA_SAFETY_RULES の精神（必ず守る）

過去にユーザーデータを破壊した事故があります（2026-04-25 の譜割タブ事故）。

### 絶対のルール 3 つ

1. **既存データを変換するコードは書かない**：localStorage / IndexedDB / project state を読み込む時は**そのまま**コピーする
2. **どうしても変換が必要な時は、必ず先にバックアップ**：別キーに保存（`${元キー}-backup-${ISO日時}`）してからユーザーに事前承認
3. **データ形式を変えたい時は新キーで並行運用**：古いキーには絶対に書き込まない

詳細は `DATA_SAFETY_RULES.md` を必読。

---

## 🏗 技術スタック

| 領域 | 採用技術 |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind + shadcn/ui |
| ルーティング | wouter（軽量、サブパス対応） |
| State | React useState/useReducer + IndexedDB（idb） |
| Backend | Node.js + Express + tsx（dev） |
| DB | PostgreSQL + drizzle-orm + drizzle-zod |
| 認証 | express-session + connect-pg-simple |
| Audio | Web Audio API + ffmpeg.wasm + @breezystack/lamejs + Web Worker |
| 外部連携 | Dropbox API（dropbox npm package） |
| 形態素解析 | kuromoji（日本語ルビ・トークナイズ） |
| デプロイ | Railway（main に push で自動デプロイ） |

### 主要ファイル（読む順）

| ファイル | 内容 | 行数の目安 |
|---|---|---|
| `client/src/pages/project.tsx` | エディタ本体（state、譜割タブ、SAMPLER、TITLE 描画） | 約 5800 行 |
| `client/src/components/timeline-editor.tsx` | タイムライン本体（ruler、blocks、波形、SECTION 帯） | 約 4000 行 |
| `client/src/components/score-panel.tsx` | 譜割タブ（4 列スプレッドシート、完全自動生成） | 約 400 行 |
| `client/src/components/sampler-panel.tsx` | SAMPLER（リハーサルマークから自動生成） | 約 100 行 |
| `client/src/components/export-dialog.tsx` | EXPORT ダイアログ（mp4 書き出し、Canvas 描画） | 約 1800 行 |
| `client/src/lib/sectionBlockOps.ts` | SECTION ブロック追加 | 短い |
| `client/src/lib/designTokens.ts` | `TS_DESIGN`（色、border、bg2 等） | 短い |
| `shared/schema.ts` | DB スキーマ（projects, lyrics, audio） | 約 200 行 |
| `server/routes.ts` | API エンドポイント全部 | 約 1700 行 |
| `server/dropbox.ts` | Dropbox API ラッパー | 約 800 行 |
| `server/dropboxMatch.ts` | ファイル名厳密マッチング + fuzzy 候補 | 約 165 行 |

---

## 🚀 セットアップ（共同開発者の Mac で）

### 必要なもの

- macOS（推奨。Windows/Linux でも動くが、のむさん環境は Mac）
- Claude デスクトップアプリ（Cowork mode 対応のもの）
- Git
- GitHub アカウント
- Node.js 20+

### 手順

```bash
# 1. リポジトリを clone
cd ~/Projects
git clone https://github.com/nrs2013/telop-studio.git
cd telop-studio

# 2. 依存パッケージをインストール
npm install

# 3. 開発サーバー起動（ローカル動作確認のみ）
npm run dev
# → http://localhost:5173 でアクセス
```

### のむさんから別途もらうもの

- GitHub のコラボレーター招待（リポへの push 権）
- Railway のチームメンバー招待（本番ログ閲覧用）
- 必要なら Dropbox の OAuth アプリ情報（普通は不要、サーバー側で持ってる）
- 本番の DATABASE_URL（普通は不要、Railway で管理）

---

## 🔄 標準的な作業フロー

### 1. のむさんから依頼を受ける

例：「タイムラインの SECTION ブロックの色を変えてほしい」

### 2. 仕様を読み解く・必要なら確認

- 「色を変える」 → どの場所？ どの色から何色へ？
- 不明点は**必ず聞く**。「推測で進めない」

### 3. 大きい変更ならモックを見せて承認取る

- HTML / SVG / 表でビジュアル提案
- のむさんの「OK」が出てから実装

### 4. 実装

- 該当ファイルを Read してから Edit
- 既存のコードのスタイルに合わせる

### 5. ビルド・型チェック確認

```bash
npx tsc --noEmit -p tsconfig.json
npx vite build --outDir /tmp/check_build
```

エラーが**新規で増えてない**ことを確認。既存の型エラーは残っててもビルドは通る（[既知の宿題](#既知の宿題)参照）。

### 6. のむさんに push コマンドを渡す

完成形のコマンドを 1 行で：

```
cd ~/Projects/telop-studio && rm -f .git/index.lock .git/HEAD.lock .git/refs/remotes/origin/main.lock .git/objects/maintenance.lock && git add <files> && git commit -m "<message>" && git push origin main
```

### 7. 動作確認

- 1〜2 分で Railway デプロイ完了
- スーパーリロード（Cmd+Shift+R）で本番反映確認

---

## ⚠️ 既知の宿題

### 実害は低いが残ってる型エラー

- `client/src/lib/bpmDetect.ts` 526 行：`channelData` / `sampleRate` がスコープ外
- `server/dropbox.ts` 704/713/722：`rawEntries` 未初期化警告
- `client/src/components/timeline-editor.tsx` 3682/3813：`origTime: number | null`
- `server/routes.ts` 内：`req.query` が `string | string[]` で受け取り

全部「実害低」と分類済み。詳細は `HANDOFF_TO_NEXT_CLAUDE.md`。

### 機能の宿題

| 領域 | 内容 |
|---|---|
| BPM 検出 | 世界最高峰化計画あり（`BPM_WORLD_CLASS_PLAN.md`） |
| Dropbox 連携 | content_hash ベースのリンク（fuzzy 候補表示は実装済み） |
| ホーム画面の検索 / フィルタ | 未実装 |

---

## 🚫 やってはいけないこと（過去の事故）

| # | 事故 | 教訓 |
|---|---|---|
| 1 | 譜割タブで古い構成のまま保存 | データの自動マイグレーションは禁止 |
| 2 | TITLE トレースで何時間もかけて巻き戻し | 大きな機能はモック先 |
| 3 | CAST モード実装 → 全削除 | 「動く」と「のむさんが運用したい」は別問題 |
| 4 | imported_audio リネームで Dropbox 失敗時の不整合 | 外部 API 失敗時の挙動を必ず明示 |
| 5 | 削除がローカルのみで翌日復活 | サーバー削除を必須にしリトライ付きに |

詳細は `HANDOFF_TO_NEXT_CLAUDE.md`「過去の事故・教訓」セクション。

---

## 📚 用語集（のむさん語 / 演出家語）

| のむさん語 | 開発側の呼び方 |
|---|---|
| 倉庫 | リポジトリ（GitHub） |
| 保存ポイント | コミット |
| アップロード | push |
| ダウンロード | pull / clone |
| 会場 | デプロイ先（Railway / GitHub Pages） |
| 公演更新 | デプロイ |
| 譜割 | 楽曲の SECTION 構成（INTRO / 1A / 1サビ など） |
| 歌割り | 各小節で誰が歌うか（TELOP では未使用、STAGE STUDIO で使う） |
| TITLE A / B / HOLD | TELOP のタイトル帯（曲名・作詞作曲表示） |
| リハーサルマーク | タイムライン上の SECTION ブロック |
| SAMPLER | リハーサルマークから自動生成される再生ジャンプボタン |

---

## 🆘 困ったとき

1. **`HANDOFF_TO_NEXT_CLAUDE.md`**（過去の作業履歴）を読み直す
2. **`DATA_SAFETY_RULES.md`** の精神に立ち返る
3. のむさんに「**確認させてください**」と聞く（推測で進めない）
4. それでも詰まったら、**TELOP STUDIO の元 Claude セッション**に「○○について教えて」と直接聞く運用も可（のむさん経由）

---

## 📝 このドキュメントの更新

新しい教訓・宿題・ルールが見つかったら、このファイルか `HANDOFF_TO_NEXT_CLAUDE.md` を**必ず更新**してください。引き継ぎは生き物です。

最終更新：2026-05-X
