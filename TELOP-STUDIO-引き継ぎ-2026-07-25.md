# TELOP STUDIO 引き継ぎ書（2026-07-25）

歌詞テロップ作成 Web アプリ。Railway（$5/月）が無料枠切れで死亡 → **完全 serverless 化（$0）** を完了した状態。
このドキュメントだけで新セッションが状況を理解して作業を続けられるように書いてある。

---

## 0. 最重要（まず読む）

- **本番 URL**: https://nrs2013.github.io/telop-studio/ （GitHub Pages・自動デプロイ・月 $0）
- **リポ**: `nrs2013/telop-studio` / ローカル `~/Projects/telop-studio`
- **最新コミット**: `f7749d2`（2026-05-30）/ 現行 bundle `index-CUzCnWnd.js`
- **のむさんはコード未経験**。結論を先に、普通の日本語で。舞台用語に例えない。コマンドはコピペできる完成形で。
- **破壊系・大改修・デザイン変更は事前確認**。コード系の How は聞かずに推奨で進める。
- **見せる前に自分で動作確認**。「全部できた」と言う前にチェックリストで自問（中途半端が一番嫌われる）。

---

## 1. このアプリは何か

- React + Vite（クライアント）。元は Express + PostgreSQL(Supabase) + Dropbox API + FFmpeg のフルスタックだった。
- **櫻坂46 / 日向坂46 等のライブ用「歌詞テロップ」を作る**：歌詞を打つ → 音源に合わせてタイミングを付ける → 透過 WebM/ProRes で書き出し → VJ/映像で使う。
- データ規模：projects=155 / lyrics=7948 / audioTracks=203 / markers=64。
- **のむさん以外の人も使う**（「元通り」の絶対条件）。iPhone では触らない（明言済み）。

---

## 2. 今の構成（serverless 化後）

```
ブラウザ（GitHub Pages）
  ├─ データ本体      : IndexedDB（origin-scoped, DB名 "telop-studio" v4）
  ├─ 認証            : Dropbox PKCE OAuth（クライアント完結・サーバ不要）
  ├─ 音源/ファイル操作 : Dropbox JS SDK 直叩き
  └─ 書き出し        : Mac の localhost dev サーバに proxy（ffmpeg 必須のため）
```

- **サーバ（Express）はもう常時は不要**。書き出しのときだけ `npm run dev` を上げる。
- クライアントの既存コードは `fetch("/api/...")` のまま。**fetch shim**（`client/src/lib/dropboxFetch.ts`）が
  `window.fetch` を 1 回だけラップして、`/api/*` を Dropbox SDK 直 or no-op に振り替える。
  dev サーバが居れば本物のレスポンス優先、404/落ちてる時だけ shim にフォールバック。

### 主要ファイル
| ファイル | 役割 |
|---|---|
| `client/src/lib/dropboxAuth.ts` | PKCE OAuth・**トークン自動更新**・team namespace 解決・セッション期限イベント |
| `client/src/lib/dropboxFetch.ts` | `/api/*` を Dropbox SDK に振り替える shim（download/browse/search/find/upload 等）+ dev-proxy |
| `client/src/lib/dropbox-auto-reconnect.ts` | `fetchDropbox` ラッパー。認証エラー時に再ログイン誘導 |
| `client/src/lib/dropboxSyncService.ts` | Dropbox を DB 化した sync（pull/push/delete） |
| `client/src/lib/syncService.ts` | 旧 `/api/sync` 経由 sync。サーバ無いとき Dropbox に自動 fallback |
| `client/src/lib/dropboxStorage.ts` | Dropbox 上の JSON 保存（`/TELOP-DATA/...`） |
| `client/src/components/dropbox-picker.tsx` | 「nrs Team Dropbox」フォルダブラウザ（手動で音源選ぶ） |
| `client/src/App.tsx` | ログイン画面振り分け・**セッション期限切れの一元処理**・dev-proxy probe |
| `.github/workflows/deploy.yml` | main push → Pages 自動デプロイ |

---

## 3. 🔴 地雷・ハマりどころ（同じ穴に落ちない）

### 3-1. Dropbox app は `50csjjo4u9fvfxw` が正解
- **"Telop Studio Lyric Sync nomura"**（key=`50csjjo4u9fvfxw`）を使う。nrs チーム配下・team admin 承認済み・PKCE Allow 済み。
- 個人 Dropbox 配下の app（`mdt05rlzjykkriu` / `ntg90kn8q9us8h6`）は **team admin 承認ループで詰む** → 使わない。
- Redirect URIs 登録済み：`https://nrs2013.github.io/telop-studio/` / `http://localhost:5001/` / `http://localhost:5173/`。
- コードの APP_KEY は `client/src/lib/dropboxAuth.ts` の `const APP_KEY`。

### 3-2. トークン自動更新（2026-05-30 完備）
- アクセストークンは **4 時間で切れる**。放置で死ぬのを直した。
- `getDropboxClient()` が persistent `DropboxAuth` を seed（clientId+refreshToken+expiresAt）し、
  SDK 内蔵 `checkAndRefreshAccessToken()`（5 分バッファ）で透過更新。更新後 localStorage 書き戻し。
- refresh_token は無期限（連携解除/PW 変更時のみ失効）。失効時だけ `DBX_SESSION_EXPIRED_EVENT` 発火 →
  App.tsx が「再ログイン」toast。**LIVE モード中は画面を飛ばさない**（演出を止めない）。IndexedDB は無傷。

### 3-3. チームフォルダは pathRoot 必須
- `/nrs チーム フォルダ/...` 等は team space namespace にある。**pathRoot を root namespace に設定しないと path/not_found**。
- `usersGetCurrentAccount().root_info.root_namespace_id` を取得 → 全クライアントに pathRoot 設定。
  namespace は localStorage `telop-dbx-root-namespace` にキャッシュ。
- 副作用：Dropbox 同期データ `/TELOP-DATA` もチーム空間に載る（共有要件的にはむしろ正しい）。

### 3-4. 書き出しは Mac の dev サーバ経由
- ffmpeg 必須なので Pages 単独では不可。`npm run dev`（localhost:5001）を上げると、Pages の UI から
  CORS 越しに proxy されて書き出せる。`server/index.ts` に `https://nrs2013.github.io` の CORS 許可あり。
- App.tsx が 30 秒ごとに localhost:5001 を probe。居れば `/api/export/*` と `/api/audio/convert-to-mp3` をそっちに rewrite。
- dev サーバ無いと 501 +「dev サーバ起動して」メッセージ。**Phase D（ffmpeg.wasm）は未実装**（SharedArrayBuffer 制約）。

### 3-5. データ復旧は Backup JSON → Restore
- IndexedDB は origin ごとに別物。移行は Backup JSON 経由。
- バックアップ例：`~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/telop-studio-backup-2026-05-24T04-45-53-900Z.json`
- ヘッダーの Restore で読み込むと projects/lyrics/audioTracks/markers/deletions が入る（**音源 blob は含まれない**）。
- 音源は各曲を開いて「Audio」から選ぶ or 「🔧 全曲リンク復元」で一括再 download。

---

## 4. 今 動くもの / 未確認のもの

| 機能 | Pages 単独 | dev(localhost:5001) |
|---|---|---|
| プロジェクト一覧・編集・自動保存 | ✅ | ✅ |
| 音源再生（filesDownload） | ✅ | ✅ |
| 音源検索（find/auto-relink）| ✅ | ✅ |
| フォルダブラウザ（picker）| ✅（2026-05-30 実装）| ✅ |
| トークン自動更新・再ログイン | ✅ 実装済（**実地の期限切れ通しテストは未**）| ✅ |
| 動画書き出し | ⏳ dev サーバ経由のみ | ✅ |

**未確認（次に触るとき確認したい）**：
1. **トークン実期限切れからの自動復帰** — ロジック検証済みだが、本物の切れトークンでの通しテストは未。
2. **「指定フォルダ最優先」検索** — 共有リンクが実パスに解決できないと全体検索にフォールバック（クラッシュはしない、優先が効かないだけ）。
   優先フォルダ：`https://www.dropbox.com/scl/fo/o1o8d9arwjt8hulh9r04x/...`（`dropboxFetch.ts` の `PRIORITY_SHARED_LINK`）。

---

## 5. 開発・デプロイ・確認の手順

### 起動（書き出しテスト時）
```bash
cd ~/Projects/telop-studio && npm run dev
```
→ localhost:5001 に Express + ffmpeg。ブラウザで Pages を ⌘+Shift+R すると 30 秒以内に proxy 検出。

### デプロイ
```bash
cd ~/Projects/telop-studio && git add -A && git commit -m "..." && git push origin main
```
→ GitHub Actions が自動ビルド＆ Pages 公開（40〜50 秒）。`gh run watch` で監視可。

### ビルド確認
```bash
cd ~/Projects/telop-studio && npx vite build
```

---

## 6. 残タスク

- **Phase D**: ffmpeg.wasm（`@ffmpeg/core-st` 単一スレッド版）で Pages 単独書き出し。SharedArrayBuffer 制約で multi-thread 不可。
  export-dialog.tsx は 1900 行・複数モード（WebM α/ProRes/fullframe/VFR）。既存 localhost 書き出しを壊さない feature flag 方式で。
- **優先フォルダの確実な解決**：shared link → shared_folder_id → namespace 指定で確実に listing する方法の検討（今は graceful degrade）。
- **再ログイン通しテスト**：実際に期限切れさせて自動復帰を確認。

---

## 7. 参照メモリ

- `project_telop_serverless_migration.md`（詳細な移行ログ・shim endpoint 一覧・Dropbox app 設定・トークン自動更新の全経緯）
- コミット履歴 `git log --oneline`（cf26faa 以降が serverless 化。f7749d2 が最新のトークン自動更新）
