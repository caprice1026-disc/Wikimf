# wikimf Web Dashboard UI / UX・フロントエンド設計書

**Last.fm for Wikipedia — Reading history as a personal knowledge profile**

| 項目 | 内容 |
|---|---|
| プロジェクト | `wikimf` |
| 文書 | Web Dashboard UI / UX・フロントエンド設計 |
| バージョン | `0.1` |
| 作成日 | 2026-10-04 |
| 対象 | MVP-A Web Dashboard、およびMVP-B以降へ拡張可能な画面基盤 |
| 基準資料 | `docs/wikimf-detailed-design-v0.1.md`, `docs/wikimf-implementation-plan-v0.1.md` |
| 状態 | 実装前のデザイン・実装ガイド。スクリーンショット通りの固定仕様ではなく、意図と優先順位を実装へ伝えるための基準 |

---

## 0. この文書の役割

この文書は、wikimfのWeb Dashboardを実装するときに「何をどの順番で見せるか」「どのような視覚言語にするか」「React側をどう構成するか」を迷わないための設計基準である。

詳細設計書がデータ、認証、読書状態、API、プライバシーなどの**機能仕様**を定義するのに対し、本書は主に以下を定義する。

- Dashboardの情報設計と画面遷移
- Last.fmから参考にする部分と、コピーしない部分
- desktop / mobileのレイアウト
- 色、余白、タイポグラフィ、状態表示などのデザイントークン
- Overview / Library / Activity / Article record / Account / Privacy / Public Profileの画面仕様
- loading / empty / error / privacy / syncなどの状態表現
- React + TypeScriptで実装する場合のコンポーネント分割
- APIデータとUIの境界
- アクセシビリティ、レスポンシブ、視覚回帰テストの方針

本書は「管理画面テンプレートを作る」ための資料ではない。wikimfのDashboardは、**Wikipediaの読書履歴が時間とともに育つことを楽しむプロフィール兼ライブラリ**として設計する。

---

# 1. Dashboardの目的

## 1.1 プロダクト上の役割

wikimfのクライアントには役割分担がある。

```text
Android Reader / Chrome Extension
    ↓
Wikipediaを読む・Scrobbleする
    ↓
FastAPI / PostgreSQL
    ↓
Web Dashboard
    ↓
履歴を眺める・整える・振り返る・管理する
```

Androidは「読む場所」、Chrome Extensionは「普段のWikipediaを記録するもの」、Web Dashboardは**記録された知識の足跡を眺める場所**とする。

Dashboardを開いた瞬間に利用者が知りたいのは、サーバーの状態や管理メニューではない。

最初に感じてほしいことは以下である。

> 「ちゃんと今日読んだWikipediaが残っている」
>
> 「最近こんなものばかり読んでいたのか」
>
> 「積み上がってきた」

したがって最優先コンテンツは**最近の読書活動**であり、総計KPIはその補助とする。

## 1.2 MVP-Aで達成する体験

ログインした利用者がDashboardを開くと、次のことが直感的に分かる。

1. 最後に読んだWikipedia記事
2. 今日 / 今週どれくらい読んだか
3. これまで何記事読んだか
4. 記事ごとの「閲覧 / 途中まで読んだ / 読了」
5. AndroidとChromeの両方が同じ履歴へ入っていること
6. 自分の履歴が非公開であること
7. 必要なら状態修正、削除、端末解除ができること

## 1.3 MVP-Aでやらないこと

初期Dashboardを以下の機能で膨らませない。

- 複雑なSNSタイムライン
- フォロワー数・いいね数を主役にする
- Neighboursのダミー表示
- AI要約
- ユーザーを評価する公開ランキング
- 意味の薄い円グラフの大量配置
- グラフDBを前提としたKnowledge Map
- 管理画面風の「12枚のKPIカード」

データ量が少ない初期ユーザーに空の分析画面を見せるより、最近読んだ1記事を丁寧に表示する方を優先する。

---

# 2. Last.fmから参考にするデザイン思想

## 2.1 参考にするもの

Last.fmから参考にするのはブランド外観ではなく、**履歴サービスとしての情報構造**である。

### A. 「最近の履歴」がプロフィールの心拍になる

Last.fmではScrobble履歴がプロフィールの中心になる。wikimfでも「最近読んだ記事」をOverviewの最も大きな領域にする。

### B. Libraryを独立した資産として扱う

履歴のタイムラインと、記事をまとめて探すLibraryは別の役割を持つ。

- Activity = いつ何を読んだか
- Library = 何を読んだことがあるか

これを混ぜない。

### C. 時間軸を切り替えて振り返る

Last.fm的な weekly / monthly / yearly の振り返りはwikimfとも相性が良い。ただしMVPでは総計・今日・7日・30日程度から始める。

### D. 「分析」と「遊び」を別レイヤーにする

Last.fm Labsのような実験的な可視化は、基本Dashboardへ全部埋め込まない。

将来の `Neighbours`、Activity Heatmap、Knowledge Bubbles、Wiki Raceなどは、通常の履歴と分離された「遊び」へ拡張できる構造にする。

## 2.2 参考にしないもの

- Last.fmのロゴ、赤、レイアウトをそのまま複製しない
- 「音楽」を「記事」に単語置換しただけのUIにしない
- album art中心の画像グリッドをWikipedia記事へ無理に適用しない
- Last.fm Proの課金導線を初期から真似しない

wikimfはWikipedia由来の**文字と履歴が中心のサービス**なので、画像よりタイポグラフィと情報密度を重視する。

---

# 3. デザインコンセプト

## 3.1 キーワード

```text
Editorial
Quiet
Data-rich
Personal
Accumulative
Trustworthy
Wikipedia-adjacent, not Wikipedia-clone
```

日本語で表すと、次のイメージである。

> **静かな知識ログ。**
>
> Wikipediaを読み歩いた跡が、古い図書カードと現代的なデータDashboardの中間くらいの密度で積み上がっていく。

## 3.2 視覚上の優先順位

1. 記事タイトル
2. 読んだ時刻 / 読書時間 / 状態
3. 集計値
4. UIの枠や装飾

装飾より文字情報を優先する。

カードを大量に浮かせるのではなく、薄い境界線と余白で情報を区切る。

## 3.3 「管理画面感」を避ける

避けたい例：

```text
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│  242   │ │ 12:42  │ │ 82%    │ │ 4,281  │
│ KPI    │ │ KPI    │ │ KPI    │ │ KPI    │
└────────┘ └────────┘ └────────┘ └────────┘

┌──────────── Chart ─────────────┐
│                                 │
└─────────────────────────────────┘
```

wikimfでは、次のように**履歴を中心に置く**。

```text
┌───────────────────────────────────────────────────────┐
│ caprice                         PRIVATE              │
│ Your Wikipedia reading history                       │
│                                                       │
│ 242 articles  ·  31 completed  ·  18h 24m  ·  428k chars
└───────────────────────────────────────────────────────┘

Recent reading                         Last 7 days
──────────────────────────            ──────────────────
量子力学                              Mon  ███  42m
  読了 · 12m · jawiki                 Tue  ██   25m
楕円曲線暗号                          Wed  ████ 51m
  途中 · 8m · jawiki                 ...
Bitcoin
  閲覧 · 2m · enwiki
```

---

# 4. 情報アーキテクチャ

## 4.1 ルート

MVP-Aの推奨ルートは以下。

```text
/login
/device-link

/app                     Overview
/app/library             Library
/app/activity            Activity
/app/articles/:articleId Article record
/app/achievements        Achievements
/app/settings/account    Account / Identities / Devices
/app/settings/privacy    Privacy / Data controls

/u/:publicHandle         Public Profile（公開ONの場合のみ）
```

`/app`配下は本人専用で、認証済みのUserをサーバー側セッションから決定する。URLやquery parameterのuser_idを権威にしない。

## 4.2 Global Navigation

Desktop:

```text
┌─────────────────────────────────────────────────────────────┐
│ wikimf                                   sync ●   avatar ▾ │
├──────────────┬──────────────────────────────────────────────┤
│ Overview     │                                              │
│ Library      │                Main Content                  │
│ Activity     │                                              │
│ Achievements │                                              │
│              │                                              │
│ Settings     │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

Mobile:

```text
┌──────────────────────────────┐
│ wikimf            avatar  ⋮ │
├──────────────────────────────┤
│                              │
│        Main Content          │
│                              │
├──────────────────────────────┤
│ Overview Library Activity ⋯ │
└──────────────────────────────┘
```

### Desktop

- 左レール幅: 220〜240px
- 本文最大幅: 1180〜1240px
- 画面が十分広い場合も無限に伸ばさない
- Settingsは下部へ分離

### Mobile

- 768px未満を目安に左レールを撤去
- `Overview / Library / Activity / More` のsticky bottom navigationへ変更
- Account / Privacy / AchievementsはMoreから遷移
- Android外部ブラウザから開いても片手で主要画面へ移動できる

---

# 5. レスポンシブ・グリッド

## 5.1 Breakpoint方針

ライブラリ固有のbreakpoint値へ依存しすぎず、レイアウト目的で以下を基準とする。

```text
< 640px       phone
640-899px     large phone / small tablet
900-1199px    tablet / small desktop
>= 1200px     desktop
```

## 5.2 Content Grid

Desktop Overview:

```text
12-column grid

Recent Activity    8 columns
Side Insights      4 columns
```

LibraryとActivityは原則full width。

Article recordは最大900px程度に絞り、長い設定フォームが横へ伸びすぎないようにする。

## 5.3 Mobile優先事項

モバイルでは情報を消すのではなく、順序を変える。

Overview:

```text
Profile header
↓
Stats rail (horizontal scroll可)
↓
Recent reading
↓
7-day activity
↓
Achievements
↓
Sync / privacy note
```

Desktopの右カラムはMobileでは下へ落とす。

---

# 6. デザイントークン

## 6.1 Color philosophy

wikimfはモノクロ寄りの基盤に、**読書活動を表す暖色のaccent**と、Wikipediaリンクを連想するblueを限定的に使う。

Last.fmのブランドカラーをコピーしない。

### Light

```css
:root {
  --bg: #f7f7f4;
  --surface: #ffffff;
  --surface-subtle: #f0f0ec;
  --surface-raised: #ffffff;

  --text: #202124;
  --text-muted: #666b70;
  --text-faint: #8a8f94;

  --border: #dedfdc;
  --border-strong: #c7c9c6;

  --accent: #c84f45;
  --accent-hover: #ad4038;
  --link: #3366cc;

  --state-viewed: #737980;
  --state-partial: #b7791f;
  --state-completed: #27805b;

  --danger: #b42318;
  --warning: #9a6700;
  --success: #247554;
}
```

### Dark

```css
[data-theme="dark"] {
  --bg: #111315;
  --surface: #181b1e;
  --surface-subtle: #202428;
  --surface-raised: #1b1f22;

  --text: #f2f2ef;
  --text-muted: #afb4b9;
  --text-faint: #858b91;

  --border: #2d3236;
  --border-strong: #41474d;

  --accent: #e06a60;
  --accent-hover: #ee7c72;
  --link: #77a7ff;

  --state-viewed: #a0a6ac;
  --state-partial: #d59a3a;
  --state-completed: #55b58a;
}
```

数値は初期案。実装後にcontrastを測定して調整する。

## 6.2 状態色

色だけで状態を伝えない。

```text
○ 閲覧
◐ 途中まで読んだ
✓ 読了
```

状態Chipには必ず文字列を含める。

## 6.3 Typography

Webfontを必須にしない。

```css
font-family:
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "Noto Sans JP",
  sans-serif;
```

推奨scale:

```text
Display       32 / 40, 700
Page title    26 / 34, 700
Section       18 / 26, 650
Body          14-16 / 22-24, 400
Meta          12-13 / 18, 400
Stat number   24-30 / 32, 650, tabular-nums
```

記事タイトルは日本語・英語とも読みやすさを優先し、無理に大文字化しない。

数値には `font-variant-numeric: tabular-nums` を利用する。

## 6.4 Spacing

4px基準。

```text
4   micro
8   inline gap
12  compact row
16  standard
24  section internal
32  section gap
48  page block
64  hero / major break
```

## 6.5 Radius / Shadow

```text
small control:  6px
card/panel:     10px
pill/chip:      999px
```

影は最小限。

基本的な情報区切りは`border`を使う。Modal、popoverなど浮いている必要があるUIだけshadowを使う。

---

# 7. 共通コンポーネント

## 7.1 AppShell

責務:

- Global navigation
- Mobile bottom navigation
- User menu
- Sync状態表示
- main content幅

AppShell自身が読書統計をfetchしない。

## 7.2 PageHeader

```text
Title
Description / date range
Actions
```

例:

```text
Library                                    [Filter] [Sort]
242 articles in your reading history
```

## 7.3 StatRail

大きなカードを4枚並べる代わりに、1本の統計列として表示する。

```text
242 Articles   |   31 Completed   |   18h 24m Reading   |   428k Est. chars
```

Mobileでは横スクロール可能。

## 7.4 ReadingRow

Dashboardで最重要の再利用コンポーネント。

```text
量子力学                                      14 min ago
Quantum mechanics / jawiki
✓ 読了        12m active        3,821 chars        Android
```

ただし英語対訳はMVPでは取得しないため、実際にはcanonical titleのみ。上は視覚例。

推奨props:

```ts
type ReadingRowProps = {
  articleId: string;
  title: string;
  wiki: "jawiki" | "enwiki";
  state: "viewed" | "partial" | "completed";
  activeMs?: number;
  estimatedChars?: number;
  source?: "android_reader" | "chrome_extension";
  occurredAt: string;
  evidence?: "inferred" | "self_reported";
};
```

クリックでArticle recordへ。

## 7.5 StatusChip

```text
○ 閲覧
◐ 途中まで
✓ 読了
```

自動 / 手動は別Chipにせず、必要な詳細画面で小さく示す。

```text
✓ 読了
  自動推定
```

## 7.6 WikiBadge

```text
JA
EN
```

言語識別に国旗を使わない。

日本語・英語は国籍ではないため。

## 7.7 SourceBadge

```text
Android
Chrome
```

ブランドアイコンの多用は避け、テキスト中心。

## 7.8 EmptyState

空データを「何もありません」で終わらせない。

例:

```text
まだ読書記録がありません。

Android ReaderまたはChrome ExtensionでWikipediaを読むと、
ここに履歴が表示されます。

[Androidを設定] [Chrome Extensionを設定]
```

## 7.9 PrivacyBadge

Overview headerに常時見える小さな表示。

```text
🔒 Private
```

クリックでPrivacy settingsへ。

利用者が「これは公開されているのか？」と毎回不安にならないことを目的とする。

## 7.10 SyncIndicator

Global headerに小さく表示。

```text
● Synced
↻ Syncing
! 3 unsynced
! Device needs attention
```

これはバックエンドの全システム状態ではなく、本人の端末/同期状態を示す。

---

# 8. Overview画面

## 8.1 目的

「最近読んだもの」と「蓄積」を一画面で確認する。

## 8.2 Desktop wireframe

```text
┌───────────────────────────────────────────────────────────────────────┐
│ caprice                                                🔒 Private    │
│ Your Wikipedia reading history                                     │
│                                                                       │
│ 242 articles  |  31 completed  |  18h 24m  |  428k estimated chars │
├──────────────────────────────────────────────┬────────────────────────┤
│                                              │                        │
│ Recent reading                              │ Last 7 days            │
│                                              │                        │
│ 量子力学                         14 min ago │  M  ████   42m        │
│ ✓ 読了  12m  JA  Android                   │  T  ██     18m        │
│ ─────────────────────────────────────────── │  W  █████  55m        │
│ Elliptic curve cryptography      2h ago     │  T  ▌       6m        │
│ ◐ 途中  8m  EN  Chrome                      │  F  ███    33m        │
│ ─────────────────────────────────────────── │                        │
│ Bitcoin                         yesterday   │ Compared with          │
│ ○ 閲覧  2m  EN  Android                     │ previous 7 days +18%   │
│                                              │                        │
│ [View all activity]                          ├────────────────────────┤
│                                              │ Recent achievements    │
│                                              │ Knowledge Explorer     │
│                                              │ 100 articles           │
│                                              │                        │
└──────────────────────────────────────────────┴────────────────────────┘
```

## 8.3 Profile header

表示:

- 表示名
- optional handle
- privacy badge
- join dateは初期は不要
- bioはMVP-Aでは不要

SNSプロフィールではなく「自分の読書ページ」なので、巨大なavatarやcover imageを初期必須にしない。

avatarは48px程度で十分。

## 8.4 StatRail

初期項目:

1. Unique articles
2. Completed articles
3. Active reading time
4. Estimated reading chars

「途中まで読んだ数」はOverviewのPrimary KPIには置かず、状態内訳へ。

理由: 主要値を増やしすぎると、読書履歴より数字のDashboardになるため。

## 8.5 Recent Reading

Overviewの主役。

初期は10〜15行。

同じ記事を複数回読んだ場合、OverviewはActivity単位で複数回出てもよい。

Libraryでは同じ記事を1件へまとめる。

## 8.6 Last 7 Days

MVP初期は高度なchart libraryを使わなくても良い。

CSSの横棒で日別active minutesを表現可能。

```text
Mon  ███████  42m
Tue  ███      18m
Wed  █████████ 55m
```

次週以降、実データ量が増えたら30日・12か月へ拡張。

## 8.7 Achievements

Overviewには最新1〜3件だけ。

称号一覧は専用画面へ。

「まだ称号がない」をペナルティ表現にしない。

---

# 9. Library画面

## 9.1 目的

「これまで何を読んだことがあるか」を記事単位で探す。

Activityとの違いを明確にする。

## 9.2 Desktop

```text
Library                                      242 articles
──────────────────────────────────────────────────────────────
[ Search your library... ] [All languages ▾] [All states ▾]
                            [Last read ▾]

Title                              State       Last read      Time
────────────────────────────────────────────────────────────────
量子力学                 JA       ✓ 読了      Today          24m
Bitcoin                  EN       ◐ 途中      Yesterday      18m
コーンスネーク            JA       ✓ 読了      Sep 28         12m
...
```

## 9.3 Filter

MVP:

- Language: All / JA / EN
- State: All / Viewed / Partial / Completed
- Sort: Last read / Most time / Title

期間filterはActivity側を優先し、Libraryへ盛り込みすぎない。

## 9.4 Search

これはWikipedia全文検索ではない。

**自分のLibrary内の記事タイトル検索**。

検索ボックスには明確に

```text
Search your library
```

と表示する。

## 9.5 Row / Table responsive

Desktopはtableに近い表示。

Mobileではカードへ完全変換するのではなく、compact listにする。

```text
量子力学                          ✓ 読了
JA · last read today
24m · 8,240 estimated chars
```

---

# 10. Activity画面

## 10.1 目的

Last.fmでいうScrobble履歴に最も近い画面。

「記事」ではなく**読書活動の時系列**を表示する。

## 10.2 Timeline

```text
Today

14:32   量子力学
        ✓ 読了 · 12m · Android

13:08   Elliptic curve cryptography
        ◐ 途中 · 8m · Chrome

11:21   量子力学
        ○ 閲覧 · 4m · Chrome

Yesterday
...
```

同じ記事が複数回出ることを許容する。

## 10.3 Filters

- Date range
- Source: All / Android / Chrome
- Language

状態filterはあってもよいが、初期優先度は低い。

## 10.4 Detail disclosure

Activity rowでは `evidence`、policy version、coverageの細かい値を常時出さない。

必要ならrowを展開する。

```text
Measurement details
Coverage: 82%
Evidence: inferred
Tracker policy: reading-v1
```

一般利用者に内部実装を押し付けない。

---

# 11. Article Record画面

## 11.1 目的

特定の記事について「自分がどう読んだか」を確認・修正・削除する。

## 11.2 Layout

```text
← Library

量子力学                                      [Open Wikipedia ↗]
Japanese Wikipedia · page 12345

✓ 読了
自動推定                                      [Change state]

Total active time     24m
Estimated chars       8,240
First recorded        2026-09-18
Last recorded         Today
Reads                 3 sessions

Reading history
────────────────────────────────────────────
Today       12m    Android      completed
Sep 30       8m    Chrome       partial
Sep 18       4m    Chrome       viewed

Danger zone
[Delete this article from my history]
```

## 11.3 Manual state

手動変更UI:

```text
Reading status

○ Viewed
○ Partially read
● Completed

This changes the displayed status only.
Reading time and estimated characters will not be increased.
```

仕様上重要な説明なので省略しない。

## 11.4 Wikipediaへのリンク

必ず外部リンクであることを分かるようにする。

DashboardからWikipediaを開いただけではその後の読書をWebが計測するとは約束しない。

補助テキスト例:

> Chrome ExtensionまたはAndroid Readerで読むとwikimfへ記録されます。

---

# 12. Achievements画面

## 12.1 目的

数値競争ではなく、「積み上げた記録を眺める遊び」。

## 12.2 Layout

画像を大量生成せず、タイポグラフィ中心のBadge gridにする。

```text
Achievements

┌─────────────────────┐ ┌─────────────────────┐
│  100                 │ │  10h                │
│  Knowledge Explorer  │ │  Long Reader        │
│  100 articles        │ │  10 hours reading   │
│  Sep 28, 2026        │ │  Oct 2, 2026        │
└─────────────────────┘ └─────────────────────┘
```

未解除称号を大量に灰色表示して焦らせる必要はない。

初期は「解除済み」と「次に近い1〜3個」で十分。

---

# 13. Settings / Account

## 13.1 Account

表示:

- Display name
- Internal account created date（必要なら）
- Connected identities
  - Google
  - GitHub
- Devices
  - Android Reader
  - Chrome Extension
- Logout

Connected identities:

```text
Google        connected as ...      [Remove]
GitHub        not connected          [Connect]
```

最後のidentityは解除できない仕様に合わせる。

## 13.2 Devices

```text
Pixel 8a / Android Reader
Last sync: 2 minutes ago
[Revoke]

Chrome / Windows
Last sync: 14 minutes ago
[Revoke]
```

device IDそのものは通常表示しない。

## 13.3 X login

MVP-Aでは表示しない。

「Coming soon」ボタンだけ先に置かない。

---

# 14. Settings / Privacy

この画面は派手にしないが、最も重要な画面の一つ。

## 14.1 Section order

1. Recording
2. Visibility
3. Data export
4. Delete history
5. Delete account

## 14.2 Recording

```text
Reading activity recording
[ ON ]

When enabled, connected wikimf clients can send reading activity.
```

各端末のローカル停止と、アカウント全体の収集設定を混同しない。

## 14.3 Visibility

デフォルト:

```text
Public profile        OFF
Total article count   OFF
Total reading time    OFF
Achievements          OFF
```

一つをONにしても他の項目を暗黙に公開しない。

## 14.4 Danger zone

色を使うのはここでよい。

```text
Delete reading history
Delete account
```

削除操作では、何が消え何が残るかを明示する。

投稿機能が入った後は「読書履歴削除」と「投稿削除」が別であることを明記する。

---

# 15. Public Profile

## 15.1 原則

公開プロフィールは本人用DashboardのDOMをCSSで隠したものにしない。

Public API / Public schemaから別画面として構築する。

## 15.2 MVPの見た目

公開をONにした情報だけを表示する。

```text
caprice
Wikipedia reading profile

242 articles        18h 24m

Achievements
Knowledge Explorer
...
```

履歴非公開ならRecent Reading領域自体を生成しない。

「Private」とマスクして記事の存在件数を推測できるようにもしない。

## 15.3 将来

NeighboursやSNSが入った場合にProfileが人間関係の入口になる。

そのためprofile headerは後から以下を足せる余白を持つ。

- Follow
- Compare
- Neighbour compatibility
- Shared articles

MVPでは実装しない。

---

# 16. Loading / Empty / Error / Offline

## 16.1 Loading

全面spinnerを長時間出さない。

- Page shellは即表示
- 数値はskeleton
- Recent rowsも3〜5行skeleton
- navigationは使用可能

## 16.2 Empty

データ量ゼロでも壊れたDashboardに見せない。

Overview:

```text
Your reading history starts here.

WikipediaをAndroid ReaderまたはChrome Extensionで読むと、
読書履歴がここに積み上がります。
```

Library:

```text
No articles yet.
```

Activity:

```text
No reading activity in this period.
[Show all time]
```

## 16.3 Error

エラー文はAPIコードをそのまま出さない。

```text
Couldn't load your recent reading.
[Retry]
```

ページの一部だけ失敗した場合、Dashboard全体をerror pageへしない。

## 16.4 Stale data

前回成功データを保持できる場合:

```text
Showing data from 12 minutes ago. Refresh failed.
```

TanStack Query等を使う場合も、stale cacheを「最新」と誤表示しない。

---

# 17. Interaction design

## 17.1 URLが状態になるもの

以下はURL queryに反映し、再読み込み・戻るで維持する。

```text
Library filter
Library sort
Activity date range
Activity source/language filters
```

例:

```text
/app/library?lang=ja&state=completed&sort=last_read
```

## 17.2 URLに入れないもの

- access token
- device token
- OAuth secret
- destructive confirmation state
- 未保存フォーム内容

## 17.3 Toast

成功toastは必要な場合だけ。

良い例:

```text
Reading status updated.
Device revoked.
```

ページ表示だけで毎回「Loaded successfully」のtoastを出さない。

## 17.4 Confirmation

必須:

- article history delete
- all history delete
- identity removal
- device revoke（Outbox影響がある場合）
- account delete

手動status変更はundo可能ならconfirmation不要。

---

# 18. アクセシビリティ

最低ライン:

- WCAG AA相当のcontrastを目標
- キーボードだけで全操作可能
- focus ringを消さない
- 色だけで読書状態を表さない
- chartにはテキスト代替 / table fallbackを用意
- 44〜48px程度のタップ領域
- screen reader用の具体的なlabel
- reduced motionを尊重
- 200%文字拡大でも主要操作を失わない

例:

悪い:

```text
aria-label="button"
```

良い:

```text
aria-label="Open Quantum mechanics on English Wikipedia"
```

---

# 19. Chart / Visualizationの使い方

## 19.1 MVPで許可する可視化

1. 日別読書時間 bar
2. 読書状態の小さな内訳bar
3. 将来のactivity heatmap

チャートは数値の意味を説明するために使い、「Dashboardっぽくする装飾」のために使わない。

## 19.2 Activity Heatmap

将来、Last.fm Pixel Gridに近い役割として追加できる。

```text
2026
Jan  ░░▒▓░░...
Feb  ░▓▓▒░░...
...
```

色強度 = active reading time など。

ただし0〜最大値の定義、timezone、日跨ぎ仕様を確定してから実装する。

## 19.3 Neighbours用可視化

MVP-AのOverviewへ空の枠だけ用意しない。

実装されたときに新しいsectionを追加する。

---

# 20. Frontend技術方針

## 20.1 推奨スタック

現行の詳細設計にある暫定案を具体化し、MVPでは次を推奨する。

```text
React + TypeScript + Vite
React Router
TanStack Query
Tailwind CSS + CSS variables
shadcn/ui または Radix系primitiveを必要箇所のみ
Lucide icons
FastAPI OpenAPIからTypeScript型を生成
```

重要なのはライブラリ名ではなく責務分離。実装開始時に大きな理由がなければこの構成でよい。

### なぜNext.jsを必須にしないか

MVP Dashboardは主に認証済みのSPAで、SEO対象ではない。

Public ProfileにSSRが必要になった時点で再検討できる。

FastAPIと同一originで静的配信または同じreverse proxy配下へ置けるReact/Viteで十分。

## 20.2 State management

Redux等のglobal storeを初期必須にしない。

```text
Server state       TanStack Query
URL state          React Router search params
Form state         component / React Hook Form（必要画面のみ）
Theme/local UI     small Context
Auth user          /me query + provider
```

APIデータのコピーをglobal storeに二重保存しない。

## 20.3 API Client

FastAPIのOpenAPIを基準にTypeScript型を生成する。

推奨構成:

```text
src/api/
  client.ts
  generated.ts
  queries/
    me.ts
    overview.ts
    library.ts
    activity.ts
    articles.ts
    devices.ts
    privacy.ts
```

認証はHttpOnly cookieを基本とし、Web access tokenをlocalStorageへ置かない。

## 20.4 Query keys

例:

```ts
["me"]
["overview", range]
["library", filters]
["activity", filters]
["article", articleId]
["devices"]
["privacy"]
```

mutation後に全部を無差別invalidateせず、影響範囲を明示する。

## 20.5 Styling

CSS variablesにsemantic tokenを持つ。

Tailwind classへ直接 `#c84f45` のようなhexを乱立させない。

```text
bg-background
bg-surface
text-foreground
text-muted
border-default
text-state-completed
```

テーマ変更時にコンポーネントを個別修正しなくて済む形にする。

---

# 21. 推奨ディレクトリ構成

```text
apps/web/
├── src/
│   ├── app/
│   │   ├── router.tsx
│   │   ├── AppShell.tsx
│   │   └── providers.tsx
│   │
│   ├── pages/
│   │   ├── overview/
│   │   ├── library/
│   │   ├── activity/
│   │   ├── article-record/
│   │   ├── achievements/
│   │   ├── settings-account/
│   │   ├── settings-privacy/
│   │   └── public-profile/
│   │
│   ├── components/
│   │   ├── reading/
│   │   │   ├── ReadingRow.tsx
│   │   │   ├── ReadingStatusChip.tsx
│   │   │   ├── WikiBadge.tsx
│   │   │   └── SourceBadge.tsx
│   │   ├── stats/
│   │   │   ├── StatRail.tsx
│   │   │   └── DailyActivityBars.tsx
│   │   ├── navigation/
│   │   ├── privacy/
│   │   ├── feedback/
│   │   └── ui/
│   │
│   ├── api/
│   │   ├── generated.ts
│   │   ├── client.ts
│   │   └── queries/
│   │
│   ├── hooks/
│   ├── lib/
│   │   ├── format-duration.ts
│   │   ├── format-chars.ts
│   │   ├── format-date.ts
│   │   └── reading-state.ts
│   │
│   ├── styles/
│   │   ├── tokens.css
│   │   └── globals.css
│   │
│   └── test/
│
├── public/
├── index.html
└── vite.config.ts
```

ページ固有コンポーネントを最初からすべて`components/`へ昇格させない。

2画面以上で意味が同じになったものだけ共通化する。

---

# 22. APIと画面の対応

エンドポイント名はバックエンド実装時のOpenAPIを正とする。本節はUIが必要とする読み取り単位を示す。

## 22.1 Overview

必要データ:

```ts
type OverviewData = {
  totals: {
    uniqueArticles: number;
    completedArticles: number;
    activeMs: number;
    estimatedChars: number;
  };
  recentActivities: ReadingActivitySummary[];
  dailyActivity: DailyReadingStat[];
  recentAchievements: AchievementSummary[];
  privacy: {
    publicProfile: boolean;
  };
};
```

Overviewのために10 APIを直列呼び出ししない。

Backendでoverview用read modelを返すか、2〜3並列queryで完了する形を目標にする。

## 22.2 Library

サーバーpagination前提。

```text
page / cursor
language
state
sort
query
```

初期から全履歴をfetchしてclientでfilterしない。

## 22.3 Activity

Activityはsession / projected activity単位。

Library APIを使い回して「それっぽく」表示しない。

## 22.4 Article Record

Article metadata + aggregated state + activity history。

manual state mutationとdelete mutationを同じ「edit article」APIへ雑にまとめない。

## 22.5 Account / Privacy

個人情報APIには `Cache-Control: private, no-store` 等を適切に設定する方針をBackendと共有する。

---

# 23. 日付・時間・数値フォーマット

## 23.1 Duration

```text
42 sec       → <1m または 42s（詳細画面）
3m 20s       → 3m
1h 12m       → 1h 12m
18h 24m      → 18h 24m
```

Overviewでは読みやすさ優先で秒を出さない。

## 23.2 Estimated chars

```text
842
8.2k
428k
1.2M
```

日本語UIで「42.8万文字」にローカライズするかは後続判断でよい。

データ自体は整数。

## 23.3 Date

最近:

```text
14 min ago
2h ago
Yesterday
```

古いもの:

```text
Sep 28, 2026
2026/09/28（ja locale）
```

内部はUTC。表示timezoneはユーザー設定またはBrowser localeを使う。

---

# 24. Privacyをデザインで伝える

wikimfでは「履歴を持つこと」自体がセンシティブになり得る。

そのためPrivacyは設定ページだけの問題ではない。

## 24.1 常時表示

本人Dashboard header:

```text
🔒 Private
```

公開OFFの場合にだけ出すのではなく、状態を常に分かる形にしてもよい。

## 24.2 ShareとHistoryを分離

将来SNS投稿を追加しても、LibraryやActivity rowに巨大なShare buttonを常時置かない。

記事共有は明示操作。

```text
⋯
Open Wikipedia
Change status
Share article
Delete history
```

のように二次操作にする。

## 24.3 Sensitive inferenceをしない

Dashboard上で

```text
"あなたは政治に興味があります"
"あなたはこの病気を気にしています"
```

のような推論を自動表示しない。

将来カテゴリ統計を作る場合も、単純な記事カテゴリ集計と人格・健康・政治属性の推定を分ける。

---

# 25. Frontend Security

- HTML excerptを`dangerouslySetInnerHTML`で表示しない
- Wikipedia由来文字列は通常text nodeとして扱う
- OAuth token / device tokenをURLやlocalStorageへ入れない
- destructive actionはCSRF対策済みmutationを使う
- Public ProfileとPrivate Dashboardのresponse typeを分ける
- `articleId`を変えるだけで他人のprivate stateへアクセスできないことはBackendで保証する
- error loggerへtoken、検索語、private article titleを無差別送信しない

Frontendで隠したから秘密になった、という設計を禁止する。

---

# 26. テスト / UI検証

## 26.1 Component level

対象:

- ReadingRow
- StatusChip
- StatRail
- EmptyState
- PrivacyBadge
- DailyActivityBars
- destructive confirmation

状態:

```text
long Japanese title
long English title
missing estimated chars
missing source
manual completed
0 seconds
very large total
light/dark
```

## 26.2 Page level

Playwright等で以下をスクリーンショット回帰対象にする。

```text
Overview desktop 1440px
Overview phone 390px
Library desktop
Library phone
Activity desktop
Article record phone
Privacy danger zone
Empty dashboard
Partial API error
Dark mode
```

pixel-perfectのためではなく、大きな崩壊を検出するために使う。

## 26.3 E2E

最低限:

```text
Login
→ Overview
→ Library
→ Article record
→ manual state change
→ Overview反映

Privacy
→ history delete
→ Libraryから消える
→ reloadしても復活しない
```

Chrome/Androidとの全体E2Eは実装計画M10で行う。

---

# 27. 実装フェーズ

Dashboardだけを一気に完成させず、バックエンドのマイルストーンに合わせて育てる。

## Phase D0 — Shell

M0〜M3に対応。

実装:

- Login
- AppShell
- Navigation
- Account placeholderではなく実データ `/me`
- Devices最小表示
- Design tokens
- light/dark

統計のダミー値を本番画面に置かない。

## Phase D1 — time_only Dashboard

M5に対応。

実装:

- Overview
- StatRail: article count / active time
- Recent Activity
- Account summary
- loading / empty / error

`Completed`や推定文字数が未実装なら表示しない。

## Phase D2 — 3 states / chars

M6に対応。

- Viewed / Partial / Completed
- Estimated chars
- Article record
- Manual state override

## Phase D3 — Multi-client / statistics

M7〜M8。

- Source badge
- Library
- Activity filters
- 7/30 day stats
- repeated reading
- daily bars

## Phase D4 — Data control / Achievements

M9。

- Privacy
- Export
- Delete
- Devices
- Achievements
- Public Profile minimum

## Phase D5 — Social / Neighbours（MVP-B以降）

- Article share
- Feed
- Public profile expansion
- Neighbours
- Labs / mini games

MVP-A用コードへ空のSNS abstractionを大量に作らない。

---

# 28. 実装受入チェック

## Visual

- [ ] Dashboardを開いたとき、Recent Readingが最も視線を集める
- [ ] 巨大KPIカードだけの管理画面になっていない
- [ ] 文字の長い日英記事タイトルで崩れない
- [ ] light/dark双方でcontrastが成立する
- [ ] 状態は色だけで判別させない
- [ ] 390px幅で横スクロールが必要なのは意図したStatRail等だけ

## UX

- [ ] Overview→Activity→Article recordの関係が分かる
- [ ] LibraryとActivityの違いがUIから理解できる
- [ ] Private/Publicがいつでも確認できる
- [ ] 削除と状態変更を混同しない
- [ ] 空データでも次に何をすればよいか分かる
- [ ] partial errorでページ全体が死なない

## Implementation

- [ ] Server stateを手製global storeへ複製していない
- [ ] FastAPI OpenAPIから型を共有している
- [ ] private dataをpublic componentへ渡すだけの設計になっていない
- [ ] API filterがURL queryと同期する
- [ ] paginationを前提としている
- [ ] auth secretをlocalStorageへ保存していない
- [ ] semantic color tokenを使用している

## Product

- [ ] 「Last.fm for Wikipedia」の意味がRecent ReadingとLibraryから感じられる
- [ ] SNSを使わなくてもDashboard単体で価値がある
- [ ] 記録が増えるほど画面が面白くなる
- [ ] 記録が少ない新規ユーザーを罰しない

---

# 29. 将来のデザイン拡張

## 29.1 Wikipedia Neighbours

将来の候補:

```text
People with nearby reading patterns

User A    82% overlap
Common public interests
Cryptography · Distributed systems · History
```

ただしセンシティブなprivate articleを説明根拠へ使わない。

Dashboard Overviewへ置く場合は「あなたに似た人」という断定より、

```text
Reading neighbours
```

程度の表現にする。

## 29.2 wikimf Labs

Last.fm Labsに相当する遊び領域として、通常Dashboardと分離可能。

候補:

- Reading Heatmap
- Article Bubbles
- Wikipedia Journey
- Wiki Race
- Year in Wikipedia
- Compare with a Neighbour

Route候補:

```text
/labs
/labs/heatmap
/labs/bubbles
/labs/journey
```

初期AppShellは後から`Labs` nav itemを1つ追加できる程度の余地だけ持てばよい。

## 29.3 Year in Wikipedia

年間まとめは、Dashboardの通常分析を肥大化させず独立体験にする。

```text
2026
1,842 articles
127h reading
3.9M estimated chars
Longest reading day ...
Most revisited articles ...
```

カテゴリ推定を導入する場合は別の仕様書で定義する。

---

# 30. 参考にしたLast.fmの要素

本書はLast.fmの視覚的複製を目的としない。以下の製品構造を参考にした。

- Scrobbleした履歴をプロフィールへ蓄積するという中心概念
- recent tracks / listening historyのような時系列履歴
- Libraryを履歴とは別の閲覧軸として持つこと
- weekly / monthly / historical reports
- activity progress meter
- Pixel Gridのような日次活動可視化
- Bubblesなど、基本プロフィールから分離したLabs形式の遊び

参考URL:

- https://www.last.fm/about/trackmymusic
- https://www.last.fm/pro/benefits
- https://www.last.fm/labs
- https://www.last.fm/labs/pixel-grid
- https://www.last.fm/labs/bubbles

---

# 31. 一文でまとめると

> **wikimf Dashboardは、Wikipedia読書履歴の「管理画面」ではなく、自分が知識のどこを歩いたかを眺めるLast.fm型プロフィールである。**

実装上迷った場合は、より多くのカード・グラフ・設定を置くのではなく、**記事タイトル、読んだ時刻、積み上がった履歴が一番よく見える方**を選ぶ。