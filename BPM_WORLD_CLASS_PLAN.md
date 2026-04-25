# BPM 世界最高峰計画書

**目標：** TELOP STUDIO の BPM／ダウンビート検出を業界トップ水準（Ableton Smart Tempo / Logic Pro Smart Tempo クラス）に引き上げる。

**作成日：** 2026-04-25
**作成者：** Claude セッション（の む さん指示）

---

## 1. 背景と問題意識

### 1.1 のむさんの実体験
- **BPM 数値は合ってるが、グリッドの小節頭がズレる**
- ズレるジャンル：
  - テンポチェンジあり（途中で速度が変わる）
  - ダブルタイム／ハーフタイム（途中で感覚が倍／半分になる）
  - バラード・R&B 系（kick が薄い、ビート曖昧）
- 既存の手動 UI（`SET BAR 1`, `GRID +0.220s` ドラッグ, `TAP`, `RE-DETECT`）は使ってる。それでも合わない。

### 1.2 現状の限界（コード確認済）
| 制約 | 場所 | 影響 |
|---|---|---|
| 1 曲＝1 BPM 固定 | `shared/schema.ts` の `detectedBpm: real`（単一値） | テンポチェンジ曲は構造的に対応不能 |
| 1 曲＝1 グリッドオフセット固定 | `bpmGridOffset: doublePrecision`（単一値） | ハーフ／ダブルタイムを区間で扱えない |
| 検出は kick-band template matching のみ | `client/src/lib/bpmDetect.ts`, `audioWorker.ts` | バラード・R&B など kick 薄ジャンルは精度低下 |
| 4/4 拍子前提 | グリッド計算が beatInterval=60/bpm × 4 | 3/4, 6/8 等は別グリッドが必要 |

---

## 2. 技術選定

### 2.1 候補比較サマリ
| 候補 | 出自 | 強み | 弱み | 採否 |
|---|---|---|---|---|
| **Beat This!** | 2024 ISMIR / CPJKU | SOTA・DBN なしで軽量・demixing 不要・モダン PyTorch 2.0+・C++/Rust ポートあり | プロジェクトはまだ若い（GitHub 注目度は急上昇中） | **採用** |
| madmom | CPJKU 旧作・業界標準 | DBN downbeat tracker が枯れてる | 12ヶ月新リリースなし、Python <3.10 限定、メンテ実質停止 | 不採用 |
| Beat-Transformer | 2022 ISMIR | madmom より downbeat +4% | demixed audio 前処理必要（Spleeter/Demucs）= 重い | 不採用 |
| All-In-One | 2024 / Adobe | beat+downbeat+tempo+**構造解析**を同時 | 最重量級・源分離必要 | 副候補（構造解析欲しくなったら） |
| BeatNet | 2021 | リアルタイム可 | F1 は Beat This! に劣る | 不採用 |
| BEAST | 2024 | ストリーミング transformer | リアルタイム特化、TELOP には不要 | 不採用 |

### 2.2 採用結論：Beat This!
**選定理由：**
1. 2024 年 SOTA（ISMIR で発表）
2. **DBN postprocessing 不要** → 推論パイプライン軽量
3. **源分離（Demucs/Spleeter）不要** → 前処理ステップなし
4. madmom と同じ CPJKU 研究室の正統な後継
5. PyTorch 2.0+ ベース → モダンランタイム
6. 依存薄い：`tqdm`, `einops`, `soxr`, `rotary-embedding-torch`
7. C++（`beat_this_cpp`）/ Rust（`beat-this` crate）ポートも存在 → 将来 Python 抜ける選択肢あり

### 2.3 副候補：All-In-One（将来）
将来的に「サビどこ？」「A メロ／B メロ自動認識」などの**構造解析**機能を TELOP STUDIO に入れたくなった場合の最有力候補。Beat This! と並走 or 置換可能。

---

## 3. 実装フェーズ計画

### Phase 1：技術選定（**今日完了**）
- [x] 候補調査（madmom, Beat-Transformer, All-In-One, BeatNet, BEAST, Beat This!）
- [x] 採用決定：**Beat This!**
- [x] 計画書作成（このファイル）

### Phase 2：ローカル PoC（次セッション、半日〜1 日）
**目的：** 本番に触らず、Mac 手元で Beat This! を動かして「本当にズレる曲を直せるか」検証。

**手順：**
1. Mac に Python 3.11（Beat This! は PyTorch 2.0+ 推奨）+ uv or pip 環境を立てる
2. `pip install torch tqdm einops soxr rotary-embedding-torch`
3. `pip install git+https://github.com/CPJKU/beat_this.git`
4. の む さんから **「ズレる曲」のサンプル mp3 を 3-5 件**もらう
5. `beat_this` で beat / downbeat を出力
6. 既存 TELOP の検出結果と比較 → 「これだけ良くなる」を数値・グラフで提示
7. 計算時間も計測（1 曲何秒？）

**成果物：** PoC スクリプト + 比較結果ドキュメント（`Phase2_PoC_Results.md`）

### Phase 3：サーバー側統合（2〜3 日）
**目的：** Railway 本番に Python + Beat This! を載せ、Node.js から呼べる API を作る。

**選択肢：**
- **A. Node プロセスから Python サブプロセスを spawn**
  - 利点：Railway の単一サービスに収まる、シンプル
  - 欠点：コールドスタートで Python+モデルロードが遅い（数秒〜10秒）
- **B. Python 専用サービスを Railway に分離（マイクロサービス化）**
  - 利点：Node 側は触らない、独立スケール可
  - 欠点：Railway サービス追加で課金 +α、サービス間通信コスト
- **C. 検出はクライアント（ブラウザ）側で ONNX Runtime Web で動かす**
  - 利点：サーバー不要、無料
  - 欠点：Beat This! の ONNX 化作業が必要、ブラウザの計算能力次第で遅い
  - Rust ポート（`beat-this` crate）の WASM 化も検討余地

**推奨：** まず **A**（Python サブプロセス）でシンプルに、ボトルネック出てから **B** に分離。

**Dockerfile 拡張案：**
```dockerfile
# 既存の node:22-trixie-slim ベースに追加
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages torch tqdm einops soxr rotary-embedding-torch \
    && pip3 install --break-system-packages git+https://github.com/CPJKU/beat_this.git
```

**API 設計（案）：**
```
POST /api/bpm/analyze
  body: { trackId: string }
  response: {
    bpm: number,                    // 平均 BPM（後方互換）
    beats: [{ time: number, isDownbeat: boolean }],   // すべての拍
    tempoMap: [{ startTime: number, endTime: number, bpm: number }],  // テンポトラック
    meter: number                   // 拍子（4 = 4/4, 3 = 3/4, etc.）
  }
```

### Phase 4：DB スキーマ拡張＋クライアント UI 改修（数日）
**スキーマ追加：**
```ts
// shared/schema.ts に追加
beatTrack: jsonb("beat_track").$type<{
  beats: Array<{ time: number; isDownbeat: boolean }>;
  tempoMap: Array<{ startTime: number; endTime: number; bpm: number }>;
  meter: number;
} | null>(),
```

**クライアント側変更：**
- `timeline-editor.tsx` のグリッド描画を「等間隔（BPM ベース）」から「`beats` 配列駆動」に変更
- 後方互換：`beatTrack` が null の既存プロジェクトは従来の単一 BPM ロジック使用
- 「ML 検出を実行」ボタンを追加（既存の `RE-DETECT` の隣）
- 結果を画面で確認 → 保存 という UX

### Phase 5：本番投入＋検証（数日）
- 段階公開：まず の む さんが「ズレる」と言った曲群でテスト
- フィードバック → 微調整
- 既存プロジェクトの一括再解析（バッチ実行 or オンデマンド）

---

## 4. リスクと対策

| リスク | 対策 |
|---|---|
| Railway のメモリ・CPU 不足で OOM | Phase 2 PoC で必要リソース実測 → 必要なら plan up |
| Python ランタイム追加で Docker イメージサイズ激増 | multi-stage build で最小化、不要パッケージ削除 |
| Beat This! プロジェクトのメンテ停止リスク | C++/Rust ポートが既にあるため最悪移植可能。フォーク前提で進める |
| 既存プロジェクトとの互換性破壊 | `beatTrack` を null 許容にして後方互換、移行は opt-in |
| 検出に時間がかかってブラウザ操作が止まる | バックグラウンドジョブ化、進捗 UI 表示 |
| ML モデルファイル（数十 MB）の Docker 同梱 | ビルド時に download、Railway 永続ボリューム検討 |

---

## 5. コスト試算

| 項目 | 概算 |
|---|---|
| Railway 月額 | 現状から +$5〜$20 程度（ピーク時のみ） |
| Beat This! ライセンス | MIT ベース（要確認）→ 商用利用可能の見込み |
| 開発工数 | Phase 2-5 合計：1〜2 週間（Claude セッション複数回） |

---

## 6. 後方互換戦略

- 既存の `detectedBpm` / `bpmGridOffset` カラムは **削除しない**。新カラム `beatTrack` を追加。
- クライアントは `beatTrack` があればそれを優先、なければ従来ロジック。
- 既存プロジェクトは ML 解析をユーザが手動トリガーして移行。一括再解析は提供するが必須にしない。
- `.telop` ファイル形式も `beatTrack` を含む新 v2 を後方互換で読み書き。

---

## 7. 次回セッションでやること

**最低限：**
1. Phase 2 PoC を実行：のむさんから「ズレる曲」サンプル mp3 を 3-5 件もらう
2. Mac 手元で Beat This! を動かして検出結果を出す
3. 既存 TELOP の検出結果と比較する表を作る
4. のむさんに「これくらい改善されました」と数値で見せる
5. OK なら Phase 3（Railway 統合）へ進む合意を取る

**準備：**
- Python 3.11 環境のセットアップガイドをのむさんに渡せる形にしておく（コード未経験のため、コマンドコピペ完成形で）

---

## 8. 関連ファイル

- `client/src/lib/bpmDetect.ts` — 現状の BPM 検出ロジック
- `client/src/lib/audioWorker.ts` — Web Worker での検出処理
- `client/src/components/timeline-editor.tsx` — グリッド描画、SET BAR 1, GRID drag
- `shared/schema.ts` — DB スキーマ（拡張対象）

## 9. 参考リンク

- [Beat This! GitHub (CPJKU/beat_this)](https://github.com/CPJKU/beat_this)
- [ISMIR 2024 paper "Accurate Beat Tracking Without DBN Postprocessing"](https://archives.ismir.net/ismir2024/paper/000019.pdf)
- [Beat This! C++ port](https://github.com/mosynthkey/beat_this_cpp)
- [Beat This! Rust crate](https://lib.rs/crates/beat-this)
- [All-In-One Music Structure Analyzer (副候補)](https://github.com/mir-aidj/all-in-one)
- [madmom（旧定番、参考）](https://github.com/CPJKU/madmom)
