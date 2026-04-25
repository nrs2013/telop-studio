# TELOP STUDIO センターハブ化 — マスター計画書

**ビジョン：** TELOP STUDIO を「コンサート演出の中央データハブ」にする。
**作成日：** 2026-04-25
**作成者：** Claude セッション（の む さん指示）

---

## 0. なぜ TELOP STUDIO がハブになり得るか

の む さん曰く：

> どの曲でも、コンサートでは **必ず歌詞テロップを作る**。
> その作業の過程で：
>   - 曲名・アーティスト
>   - 歌詞（行ごと）
>   - 音源ファイル（Dropbox 連携）
>   - テンポ（BPM）
>   - 小節構造
>
> がすべて TELOP STUDIO に集まる。**この情報セットは、ステージング・ダンス・照明・特効を含む全演出データの "土台" になる**。
> なら TELOP STUDIO を中央ハブにし、`.telop` ファイルが「その曲のすべての演出基礎データ」を持つ形にすれば、他のツール（特に STAGE STUDIO）に渡すだけで現場が回る。

これは正しい。歌詞テロップは演出ワークフローの **不可逆な必須工程** であり、ここに情報が集まる構造は自然。

---

## 1. 大きな 3 本柱

| 柱 | 内容 | 関連既存計画 |
|---|---|---|
| **A. 同期の正確さ向上** | BPM／ダウンビート／拍子の検出を業界トップ水準に。Beat This! 統合 | `BPM_WORLD_CLASS_PLAN.md` |
| **B. 譜割データ追加** | 歌詞 ↔ 小節 ↔ Section の紐付け。STAGE STUDIO ライクな「4 小節ごと」ビューを別タブで | 本書で新規定義 |
| **C. データ連携・統合の中心化** | `.telop` v2 フォーマット拡張。STAGE STUDIO に渡す API／添付経路。将来統合 | 本書で新規定義 |

**これら 3 本は独立に見えて、実は 1 本のレールに乗ってる：**
- A（正確な拍）が無いと B（譜割）の自動生成が雑になる
- B が無いと C（STAGE STUDIO に渡す情報）が片手落ち
- C が完成して初めて「ハブ」として機能する

つまり進行順は **A → B → C**。並行も可能だが、依存関係は意識する。

---

## 2. 柱 B：譜割タブ仕様（**今回の主題**）

### 2.1 参考デザイン
の む さんの「アプリDemo.pptx」にある STAGE STUDIO 風の総合スコア。**1 行 = 4 小節分**で、行毎に：

| 列 | 内容 | TELOP に必要？ |
|---|---|---|
| TIME | タイムスタンプ（曲頭からの秒） | ✓ 既存 BPM＋小節情報から自動算出 |
| SING | 歌うメンバー | ✓ 譜割の核情報（手動指定） |
| PA | PA 区分（ALL ブロック等） | △ 将来検討、まずスキップ |
| Section | 曲構造（INTRO, 1A, 1B, 1C, INTER, 2A, BRIDGE, D, 3C, OUTRO 等） | ✓ 譜割の核情報（手動指定 or AI 推定） |
| Bar | この行の小節数（基本 4、拡張可） | ✓ 譜割の核情報 |
| lyrics | 歌詞テキスト | ✓ 既存。行を「4 小節グループ」にまとめて表示 |
| SCORE | 譜面（音符） | × TELOP では持たない（STAGE STUDIO 領域） |
| ステージング/特効/機構/レーザー/バルーン/トロッコ/MEMO | 演出データ | × STAGE STUDIO 領域 |

→ **TELOP の譜割タブが扱うのは：TIME・SING・Section・Bar・lyrics の 5 列だけ。** これが STAGE STUDIO の入力になり、それ以降の演出データは STAGE STUDIO 側で構築。

### 2.2 譜割タブの UX
- プロジェクトページに **タブ切替** を追加：「**LYRICS**（既存の番号順）」「**SECTIONS**（新・4 小節譜割ビュー）」
- SECTIONS タブの中身：
  - 各行 = 1 つの **譜割ブロック**（既定 4 小節）
  - ブロックごとに：
    - **時刻**（自動：拍頭時刻から計算）
    - **Section ラベル**（プルダウン：INTRO/A/B/C/サビ/BRIDGE/D/OUTRO/カスタム文字列）
    - **小節数**（数字入力：既定 4、変更可。3 や 8 もあり）
    - **歌唱者** 複数選択可（メンバー or "ALL"）
    - **歌詞テキスト**（複数行可）
- **左マージン** に「ブロック追加」「分割」「結合」「上下移動」アイコン
- ドラッグで歌詞行をブロック間移動できる

### 2.3 データモデル（クライアント側 TypeScript）
```ts
type SectionLabel =
  | "INTRO" | "A" | "B" | "C" | "サビ"
  | "BRIDGE" | "D" | "INTER" | "OUTRO"
  | string;  // カスタム可

type SingerId = string;  // 既存のメンバー識別子

type LyricBlock = {
  id: string;              // uuid
  startBar: number;        // 0 origin の小節番号（拍頭から）
  barCount: number;        // 通常 4、可変
  section: SectionLabel;   // ラベル
  singers: SingerId[];     // 歌唱者リスト（ALL は特殊値）
  lyricLineIds: string[];  // 既存 LyricLine[] の id を順序参照
  // 注：歌詞テキストは複製しない。既存 LyricLine[] の参照のみ持つ
};

type SongStructure = {
  blocks: LyricBlock[];
};
```

**ポイント：** 既存の `LyricLine[]`（時刻ベースの歌詞行）は触らない。`SongStructure.blocks` は **既存歌詞行を「4 小節単位の意味のかたまり」に再グループ化する別レイヤー**として追加。後方互換◎。

### 2.4 DB スキーマ拡張
```ts
// shared/schema.ts に追加
songStructure: jsonb("song_structure").$type<SongStructure | null>(),
```
- null ＝ まだ譜割を作ってない（既存プロジェクト全部こうなる）
- non-null ＝ 譜割タブで作られた構造あり
- 後方互換：null のときは既存の歌詞リストだけ表示

### 2.5 自動譜割（Phase B-2）
柱 A（Beat This!）が完成して **拍頭時刻が正確に出る** ようになったら、
- 既存歌詞行の時刻 → 何小節目か計算
- 4 小節ずつまとめて自動的に `LyricBlock[]` を生成
- ユーザは Section ラベルと歌唱者だけ手で埋める

→ **柱 A の完成が前提**。それまでは手動譜割のみ。

---

## 3. 柱 C：.telop v2 フォーマット & STAGE STUDIO 連携

### 3.1 .telop v2 フォーマット案
既存 v1 の JSON に以下を追加：

```jsonc
{
  // === v1 既存（変更なし） ===
  "version": 2,
  "name": "サイレントマジョリティ",
  "audioFileName": "サイレントマジョリティ_44k16.wav",
  "bpm": 123,
  "lyrics": [/* 既存 LyricLine[] */],
  // ...

  // === v2 新規 ===
  "songStructure": {
    "blocks": [
      {
        "id": "blk_001",
        "startBar": 0,
        "barCount": 4,
        "section": "INTRO",
        "singers": [],
        "lyricLineIds": []
      },
      {
        "id": "blk_002",
        "startBar": 4,
        "barCount": 4,
        "section": "1A",
        "singers": ["matsumoto", "shio"],
        "lyricLineIds": ["lyr_001"]
      }
      // ...
    ]
  },
  "beatTrack": {
    // 柱 A から流れてくる正確な拍時刻データ
    "beats": [{ "time": 0.500, "isDownbeat": true }, /*…*/ ],
    "tempoMap": [{ "startTime": 0, "endTime": 60.5, "bpm": 123 }],
    "meter": 4
  },
  "members": [
    // 譜割で参照されるメンバー名簿
    { "id": "matsumoto", "displayName": "松本", "color": "#ff6464" },
    { "id": "shio", "displayName": "潮", "color": "#ffaa64" }
  ]
}
```

**設計ポリシー：**
- v2 ＝ v1 のスーパーセット。v1 を読める実装は v2 の追加フィールドを無視するだけで OK
- 逆に v2 実装は v1 を読めるよう `version` で分岐
- 将来 v3 が出ても同じ方針

### 3.2 STAGE STUDIO への引き渡し経路
**2 段階アプローチ：**

#### Phase C-1（短期）：ファイル添付経由
- TELOP の EXPORT メニューに「**STAGE STUDIO 用に書き出す**」を追加
- `.telop` ファイルをそのまま渡す（v2 で必要情報全部入ってるはず）
- STAGE STUDIO 側で `.telop` import 機能を実装（要 STAGE STUDIO 側コード変更）
- これで **両方独立アプリのまま、データだけ渡せる状態** が完成

#### Phase C-2（中期）：API 連携
- STAGE STUDIO が稼働中の TELOP に問い合わせて最新の譜割を引っ張る
- 同期されるので、TELOP で歌詞修正したら STAGE STUDIO に即反映
- 両方サーバーがある前提

#### Phase C-3（長期）：完全統合
- TELOP STUDIO ＝ STAGE STUDIO の **モジュール 1 つ** に格上げ
- 1 本のアプリで「歌詞テロップ作成」→「ステージング設計」までシームレス
- DB 共通、UI タブ統合
- これが究極系

### 3.3 STAGE STUDIO 側の現状ヒアリング（要確認）
- リポジトリ名（仮：`nrs2013/stage-studio-2`？） → **次回確認**
- 現在のデータ構造（特に楽曲・歌詞・小節をどう持ってる？）
- `.telop` 受け入れの実装難易度
- 統合の本気度（短期で進める？数年スパン？）

---

## 4. フェーズ全体マップ

```
今日 (Phase 0) ─ マスター計画書（A + B + C）
        │
        ▼
Phase A1-A5 ─ Beat This! 統合（BPM 世界最高峰）
        │   = 同期の正確さの基盤
        ▼
Phase B1 ─ 譜割タブ UI（手動）
Phase B2 ─ 自動譜割（A 完成後）
        │
        ▼
Phase C1 ─ .telop v2 + ファイル添付経由で STAGE STUDIO へ
Phase C2 ─ API 連携
Phase C3 ─ 完全統合（究極系）
```

**今日のステータス：** Phase 0（このドキュメント作成）まで。

**次回優先度の推奨：**
1. **Phase A2**（Beat This! ローカル PoC）→ 柱 A の前進
2. **Phase B1**（譜割タブ手動 UI）→ 並行可能、A 不要で着手できる
3. STAGE STUDIO の現状ヒアリング → C1 設計のため

---

## 5. 設計上の重要原則

### 5.1 後方互換は絶対崩さない
- 既存 .telop（v1）は永久に読める
- 既存プロジェクトデータも触らない
- 新機能はすべて opt-in

### 5.2 データの正本（Single Source of Truth）
- 歌詞行の時刻 → 既存 `LyricLine[]` のまま。譜割で複製しない
- 拍タイミング → 新 `beatTrack`（柱 A）に集約
- 譜割 → 新 `songStructure`（柱 B）に集約
- これらが全部揃って初めて STAGE STUDIO に意味のあるデータが渡る

### 5.3 STAGE STUDIO 側の負担を最小化
- TELOP が「整った形」で .telop を出す
- STAGE STUDIO は **読み込み実装だけで** 譜割・拍・歌詞・メンバーが全部入る
- これが「ハブ」の意味

---

## 6. リスクと留意事項

| リスク | 対策 |
|---|---|
| 柱 A が長引いて B/C が止まる | B1（手動譜割タブ）は A なしで着手可能。並行進行 |
| .telop v1 を読む既存実装（部下含む）が壊れる | v2 は v1 のスーパーセット、追加フィールド無視で v1 として動く |
| STAGE STUDIO 側の改修コストが大きい | Phase C を 3 段階に分けた。最初は「読み込みだけ」追加で済む |
| メンバー名簿の整合性（TELOP と STAGE STUDIO で id 違う等） | v2 .telop に `members[]` を含めることで自己完結。受け側がマッピング |
| 譜割 UI が複雑化しすぎてユーザ離脱 | LYRICS／SECTIONS タブで切替、既存ユーザは触らなくて OK |

---

## 7. 次回 Claude セッションでやること

**最低限のキャッチアップ手順：**
1. このファイル（`MASTER_PLAN_HUB.md`）を **必ず最初に読む**
2. `BPM_WORLD_CLASS_PLAN.md` も読む（柱 A の詳細）
3. `HANDOFF_TO_NEXT_CLAUDE.md` も読む（直近の作業履歴）

**次回の選択肢：**
- **A 系：** Phase A2（Beat This! ローカル PoC）→ の む さんに「ズレる曲」mp3 を 3-5 件もらう必要
- **B 系：** Phase B1（譜割タブ手動 UI）→ 設計→実装→push、本番に乗る
- **C 系：** STAGE STUDIO リポジトリを GitHub で覗いて、`.telop` 受け入れ難易度を見積もる

の む さんに「次どこから？」を確認してから着手。

---

## 8. 関連ドキュメント

- `BPM_WORLD_CLASS_PLAN.md` — 柱 A の詳細実装計画
- `HANDOFF_TO_NEXT_CLAUDE.md` — 直近のセッション履歴と未解決事項
- `アプリDemo.pptx`（の む さん手元、上げてもらえばこちらで参照可）— 譜割ビューの参考デザイン
- `client/src/pages/project.tsx` — エディタ本体
- `shared/schema.ts` — DB スキーマ（拡張対象）

## 9. 用語集（次回 Claude のため）

| 用語 | 意味 |
|---|---|
| 譜割（ふわり） | 歌詞を「Section ＋ 小節数」のブロックに整理する作業／結果 |
| Section | 曲構造のラベル（INTRO, A メロ, B メロ, サビ, BRIDGE, OUTRO 等） |
| Bar | 小節 |
| Downbeat | 各小節の 1 拍目 |
| LyricBlock | 譜割タブで定義する「4 小節分の意味のかたまり」 |
| .telop v1 | 現行フォーマット（歌詞・BPM・基本情報） |
| .telop v2 | 提案フォーマット（v1 ＋ songStructure ＋ beatTrack ＋ members） |
| STAGE STUDIO | の む さんの別アプリ。総合演出スコアを扱う |
| ハブ | TELOP が中心になり、他ツール（特に STAGE STUDIO）に整った演出データを渡す構図 |
