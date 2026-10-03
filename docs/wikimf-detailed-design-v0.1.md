# wikimf 詳細設計書

**Last.fm for Wikipedia**

| 項目 | 内容 |
|---|---|
| プロジェクト名 | `wikimf` |
| 文書バージョン | `0.1` |
| 作成日 | 2026-10-04 |
| 状態 | 実装前の統合設計案。実装・動作検証・デプロイ完了を意味しない |
| 主な入力 | 本会話のユーザー指定、これまでの議論、添付 `wikipedia-sns-mvp-design.md` |
| 想定読者 | 開発者本人、将来の協力者、実装を担当するコーディングエージェント |

## 根拠と確度

本文では、仕様の確度を次のように区別する。

- **[確定]**：ユーザーが明示的に指定、または合意した方針。
- **[設計案]**：合意を実装可能な形にするための提案。API名、テーブル名、具体的な閾値、保持件数などを含む。
- **[後続]**：作りたい方向性として残すが、初期の完成条件には含めない機能。
- **[未決]**：会話で決まっていない事項。仮置きの推奨値がある場合も、確定事項とは扱わない。
- **[外部仕様]**：末尾の公式資料に基づく制約・仕様。プロジェクトの意思決定とは別の根拠。

特記のない細部は **[設計案]** であり、「ユーザーが既に決めたこと」には置き換えない。実装開始時に、この文書を暫定仕様として採用するか、必要な項目だけ変更する。

## 情報の優先順位

```text
直近のユーザーの明示的な指定
    > 過去のユーザーの合意
    > 添付設計のうち現在の合意と矛盾しない部分
    > 過去のアシスタントの提案
    > 本文書の新規提案
```

添付設計は2026-09-28時点の移植提案であり、Flask、SQLite、日本語のみなど、今回の合意と異なる箇所がある。その差分を明示して更新する。既存リポジトリのコード状態については、添付資料に記載された静的調査を参照しただけで、本書の作成時に再取得・実行していない。[^S1]

名称はユーザー指定どおり **`wikimf`** とする。会話中の `wikifm` などに自動修正しない。参考サービスは **Last.fm** であり、会話中の `last.fun` は文脈上Last.fmを指すものとして整理する。サービス名・ドメイン・商標の利用可能性は未調査。

---

## 目次

| 章 | 内容 | 章 | 内容 |
|---|---|---|---|
| 01 | [プロダクト思想と成功条件](#s01) | 16 | [同期・冪等性・オフライン・エラー](#s16) |
| 02 | [合意済み仕様と旧設計からの変更](#s02) | 17 | [HTTP APIとレスポンス設計](#s17) |
| 03 | [MVPの範囲と将来機能](#s03) | 18 | [認証・ユーザーID・アカウント連携](#s18) |
| 04 | [用語とドメインモデル](#s04) | 19 | [DBモデル・トランザクション・可搬性](#s19) |
| 05 | [システム構成と責務分離](#s05) | 20 | [プライバシー・停止・削除・保存期間](#s20) |
| 06 | [Androidアプリの画面・状態・基本操作](#s06) | 21 | [Web Dashboardと最小ソーシャル](#s21) |
| 07 | [検索画面の詳細仕様](#s07) | 22 | [既存Wikipedia_Raceの再利用方針](#s22) |
| 08 | [URL・記事遷移・外部ブラウザの境界](#s08) | 23 | [コード構成・設定・外部サービス運用](#s23) |
| 09 | [Android実装とWebViewの安全な境界](#s09) | 24 | [テスト計画と受入条件](#s24) |
| 10 | [Chrome拡張の設計](#s10) | 25 | [非機能要件・監視・障害時の体験](#s25) |
| 11 | [記事識別・逆引き・表示版の扱い](#s11) | 26 | [段階的な実装計画](#s26) |
| 12 | [共通trackerと読書行動の観測](#s12) | 27 | [Neighbours・ミニゲームへの拡張方針](#s27) |
| 13 | [閲覧・途中まで読んだ・読了の判定](#s13) | 28 | [主要な設計判断と採用理由](#s28) |
| 14 | [集計・再読・複数端末・称号](#s14) | 29 | [未決事項・仮置き値・要件トレース](#s29) |
| 15 | [共通イベント契約](#s15) | 30 | [参照資料と検証範囲](#s30) |

---

<a id="s01"></a>

## 01. プロダクト思想と成功条件

### 1.1 何を作るか [確定]

> 普段どおりWikipediaを読むと、読書の足跡が記録される。  
> 足跡から自分の興味を発見し、記事を共有し、興味の近い人やミニゲームに出会えるサービス。

主役は新しい百科事典でも、Wikipediaの再実装でもない。**Wikipediaの読書履歴を、自分のプロフィールと遊びに変える記録サービス**である。

Last.fmから参考にするのは、外部の再生環境で生じる行動を記録し、その履歴から個人のチャートや推薦などを構成する考え方である。Last.fmのAPIではNow PlayingとScrobbleを分けているが、wikimfがそのAPI、閾値、公開範囲をそのまま採用するわけではない。[^W1]

```text
Wikipediaを普通に読む
    ↓
同意した範囲で読書行動が記録される
    ↓
履歴・統計・称号が育つ
    ↓
面白い記事を自分の意思で共有する
    ↓
Neighbours・ミニゲーム・他の人の発見につながる
    ↓
またWikipediaを読む
```

### 1.2 変えない設計原則

| 原則 | 意図 |
|---|---|
| 記事表示はWikipediaに任せる | 記事レンダラー、表、数式、脚注などの再実装を避ける |
| 読む場所は複数、記録先は一つ | PCとAndroidの利用を一つのユーザー履歴に統合する |
| 使うだけで記録が育つ | 投稿し続けないと価値が出ないSNSにしない |
| 一人でも楽しめる | 最初の価値を履歴・統計・称号で成立させる |
| 読書を証明したと主張しない | 観測できるのは画面表示と操作であり、視線や理解ではない |
| 読書履歴は本人のもの | 非公開を標準とし、公開・共有は明示操作にする |
| UIは小さく、裏側の整合性は守る | 画面を削っても認証、再送の冪等性、データ分離は削らない |
| 将来機能のために現在を巨大化しない | 推薦基盤、グラフDB、汎用ゲームエンジンは先に作らない |

### 1.3 MVPの成功条件 [確定方針を具体化]

```text
PC Chromeで日本語の記事を読む
    ↓
Androidで英語の記事を読む
    ↓
Web Dashboardを開く
    ↓
同じアカウントに両方の読書記録がまとまっている
```

そのうえで、次のことができれば中核MVPは成立する。

- 閲覧・途中まで読んだ・読了が区別され、どう判定されたか分かる。
- アクティブ閲覧時間、記事数、推定読書文字数が確認できる。
- Androidで検索から記事へ迷わず到達できる。
- 一時停止、履歴削除、端末解除ができる。
- 通信の再送や複数タブによって実績が単純に水増しされない。

**検証したい仮説**は「記録の蓄積を見たくてまた使うか」である。利用者数、継続率、Neighboursの精度などの目標数値はまだ決めない。計測自体が不快、検索が使いづらい、記録が信用できない場合は、SNS機能を増やす前に直す。

---

<a id="s02"></a>

## 02. 合意済み仕様と旧設計からの変更

### 2.1 決定一覧

| ID | 項目 | 内容 | 確度 |
|---|---|---|---|
| D01 | 名称 | `wikimf` | 確定 |
| D02 | 思想 | Last.fm for Wikipedia | 確定 |
| D03 | 全体構成 | PC Chrome Extension + Android WebView Reader + Web Dashboard | 確定 |
| D04 | モバイル対象 | 当面Androidのみ。iOSは作らない | 確定 |
| D05 | Android表示 | WikipediaそのものをWebViewで開く薄いクライアント | 確定 |
| D06 | 対象言語 | 日本語版と英語版Wikipedia | 確定 |
| D07 | Android技術 | Kotlin + Jetpack Compose + AndroidX WebKitを採用する前提 | 議論を引き継ぐ設計案 |
| D08 | 上部操作 | 戻る・進む・検索・メニュー | 確定 |
| D09 | 下部タブ | Reader / Account | 確定 |
| D10 | 検索 | オートコンプリートと本文を含む検索の両方 | 確定 |
| D11 | 言語選択 | 検索画面に配置 | 確定 |
| D12 | ゼロ入力 | 最近見た記事、最近検索した記事を表示 | 確定 |
| D13 | 外部リンク | アプリ内Readerを離れ、外部ブラウザで開く | 確定 |
| D14 | Account | 最小の情報だけ置き、詳細はDashboardへ | 確定 |
| D15 | バックエンド | FastAPI + SQLAlchemy。Alembicを移行管理に用いる案 | 基本スタック確定、Alembicは設計案 |
| D16 | DB | PostgreSQLを基本に、DB変更余地を残す | 確定 |
| D17 | 読書状態 | 閲覧・途中まで読んだ・読了の3状態 | 確定 |
| D18 | イベント | AndroidとChrome拡張で共通形式 | 確定 |
| D19 | 記事識別 | `(wiki, page_id)`、IDからの記事情報逆引きAPIを用意 | 確定 |
| D20 | ログイン | Google、GitHub | 確定 |
| D21 | Xログイン | Twitter(X)も候補。優先度は低い | 後続 |
| D22 | ユーザーID | 認証手段と独立した共通の内部ユーザーID | 確定 |
| D23 | 公開範囲 | 非公開が標準。本人の明示操作のみ共有 | 確定 |
| D24 | 将来の遊び | Wikipedia Neighbours、Wikipedia由来のミニゲーム | 方向性確定、詳細・時期は後続 |

「Androidアプリのみ」は**モバイルOSの対象**を意味するものとして扱い、PC拡張とDashboardを全体構成から除かない。工程上はAndroidから先に実装してよい。

### 2.2 添付設計からの更新

| 旧設計・過去案 | 今回の整理 |
|---|---|
| Flask / SQLiteを中心に既存資産を増築 | FastAPI / SQLAlchemy / PostgreSQLを基本にする |
| 日本語Wikipedia・Chromeのみを最小対象 | 日本語・英語、AndroidとChromeの両方を対象にする |
| 閲覧・読了推定・読了申告を表の状態として扱う | UIは3状態にし、自動推定・本人申告は別の根拠属性にする |
| 名前未定、`wikifm`など候補あり | `wikimf`に統一 |
| 独自Readerを作らない | 独自記事レンダラーは作らない。Androidには本家表示のWebView Readerを作る |
| 初期フィードを先に作る移植順 | 自動記録・検索・統計を先に成立させる案。共有機能の意図は残す |
| PoC簡略化としてイベントIDなども後回しにする案 | ID・重複排除・永続キューは初期から残す。簡略化するのはUIや高度機能 |

添付文書の読書計測、記事識別、再送、プライバシーに関する整理は引き継ぐが、今回の構成に合わせて再設計する。[^S1]

---

<a id="s03"></a>

## 03. MVPの範囲と将来機能

### 3.1 中核MVP [設計上のリリース境界]

**Android**：本家記事表示、前後移動、検索、言語切替、履歴候補、ログイン・端末連携、読書計測、未送信キュー、記録停止、最小Account、Dashboardへの導線。

**Chrome拡張**：日本語・英語記事の検出、同じ読書計測、端末連携、停止・同期状態、Dashboardへの導線。

**Backend**：認証、ユーザー・端末、記事解決・逆引き、共通イベント受付、読書状態・統計、固定ルールの称号、プライバシー設定、削除。

**Web Dashboard**：ログイン、自分の履歴・統計・称号、手動の状態修正、端末管理、公開範囲・削除設定。スマホの外部ブラウザからも利用できるレスポンシブUI。

### 3.2 SNS機能は二段階にする [設計案]

初期の発想には「記事をコメント付きで共有するタイムライン」が含まれる。これを削除したのではなく、次のように工程を分ける。

| 段階 | 完成内容 |
|---|---|
| MVP-A：記録サービス | 自動記録・検索・自分のDashboard・基本称号 |
| MVP-B：最小ソーシャル | 自分が選んだ記事への一言投稿、時系列フィード、投稿削除、最低限の通報・運営対応 |
| その後 | フォロー、返信、Neighbours、推薦、ミニゲーム |

MVP-Aを最初に配布するか、MVP-Bまで含めて初回公開するかは未決。実装順はA→Bを推奨する。公開フィードの開発と運営を、読書記録の技術検証の前提にしない。

AndroidのOS共有からWikipediaのURLを送る機能は、サービス内の公開投稿とは別物である。URL共有を行っても、自動的にwikimf上の公開投稿は作らない。

### 3.3 後回しにすること

iOS、Safari/Firefox対応、第三の言語、Wikipediaアカウント連携、編集支援、記事のオフライン保存、独自記事レンダラー、全記事クロール、LLMによる記事要約、課金、公開読書ランキング、金銭報酬、独自推薦モデル、グラフDB、リアルタイム対戦。

Neighboursとミニゲームは明確な将来目標だが、MVPの計測基盤をそれらに依存させない。

### 3.4 非目標

- 人間が本当に理解したことを証明する。
- すべてのブラウザや公式Wikipediaアプリの閲覧を無断で集める。
- Wikipediaの検索・記事表示を完全に置き換える。
- Last.fmとの直接的なAPI連携やアカウント互換を持つ。
- PostgreSQLを使いながら、無検証であらゆるDBへ切り替えられると保証する。

---

<a id="s04"></a>

## 04. 用語とドメインモデル

| 用語 | このサービスでの意味 |
|---|---|
| `wiki` | Wikipediaのサイト識別子。MVPは`jawiki` / `enwiki` |
| `language` | UI・検索先の言語コード。`ja` / `en` |
| `page_id` | それぞれのwiki内の記事ID。wikiを伴わない単独IDは使用しない |
| `article_id` | wikimf内部のArticle UUID。APIの短い参照や外部キーに使う |
| Article | Wikipediaの一つのページの、wikimf側での管理単位 |
| Document | 実際に表示された本文と抽出方式の組。記事そのものとは区別 |
| ReadingSession | ある端末で、そのDocumentを観測する一回のセッション |
| ReadingEvent | セッション内の観測通知。何件送ってもそのまま読書回数にはしない |
| ReadingActivity / Scrobble | 一定の閲覧条件を満たしたセッションを履歴へ投影したもの |
| ReadingState | 記事ごとの「閲覧」「途中まで読んだ」「読了」 |
| Evidence | 状態の根拠。`inferred`または`self_reported` |
| Coverage | 定義した本文のうち、表示条件を満たした文字の割合 |
| Active time | 画面表示・フォーカス・操作などの条件を満たした時間 |
| Outbox | サーバーへの送信待ちイベントを永続保存するキュー |
| Projection | イベントから計算する履歴・状態・統計などの参照用データ |

### 大切な区別

```text
記事を開く ≠ 閲覧条件を満たす ≠ 読了する
観測イベントの数 ≠ 読書セッションの数 ≠ 読んだ記事の種類数
自動で推定された読了 ≠ 本人が申告した読了
```

`Scrobble`は内部で「記録された読書活動」を指す用語として使い、**読了の同義語にはしない**。途中まで読むことも記録する。一般ユーザー向けUIでは、専門用語より「読書記録」「記録中」を優先する。

日本語と英語の同じ主題の記事は、MVPでは別のArticleとして数える。同じ主題かどうかの統合は、将来のWikidata等による関連付けの対象とし、識別の主キーを変更しない。

---

<a id="s05"></a>

## 05. システム構成と責務分離

```text
                          Wikimedia
                    記事表示 / 検索 / 記事情報
                       ↑          ↑
                ┌──────┘          └────────┐
                │                          │
        Android WebView               PC Chrome
        Kotlin / Compose              Wikipedia本家
                │                          │
        Android Host Adapter         Extension Host Adapter
                └──────────┬───────────────┘
                           │
                 共通 wiki-tracker.js
                  DOM観測・進捗・時間
                           │
               端末別の永続Outbox・認証
                           │ HTTPS / 共通契約
                           ▼
                    FastAPI Backend
             認証 / 記事 / 記録 / 集計 / 公開制御
                           │
                 SQLAlchemy + Alembic
                           │
                       PostgreSQL
                           ↑
                     Web Dashboard
```

図は論理構成であり、trackerを端末間で実行するのではない。同じTypeScriptソースをビルドし、各クライアントに同梱して実行する。

### 5.1 共通化するもの

`packages/wiki-tracker`に、本文抽出、chunk化、表示判定、読書時間の候補計測、観測snapshot生成を集める。

`packages/contracts`に、イベントのJSON Schema、生成されたTypeScript型・Kotlinモデル、サンプルと契約テストを配置する案とする。**APIスキーマの基準はFastAPI側のPydanticモデル**とし、同じスキーマを手で三重管理しない。

### 5.2 共通化しないもの

| Android固有 | Chrome拡張固有 |
|---|---|
| Activity / WebViewのライフサイクル | タブ・ウィンドウの選択状態 |
| origin制限付きJSメッセージ受信 | content scriptとworker間の通信 |
| RoomによるOutbox | IndexedDBによるOutbox |
| アプリ用トークン保管 | trusted extension contextでの保管 |
| WorkManager等での再送契機 | worker起動・alarm等での再送契機 |
| Native検索UI | popupと設定画面 |

共通trackerに`chrome.*`やAndroid固有APIを直接持ち込まない。

### 5.3 バックエンドが決めること

ユーザーID、記事の正規化、イベントの受理、重複排除、計上可能時間、最終読書状態、称号、公開範囲はサーバーを正とする。

クライアントが送る`source`やcoverageの自己申告だけを信用して特典を与えない。ただしサーバーで整合性を検査しても、人間の読書の証明にはならない。

### 5.4 最初は単一アプリケーション

FastAPIのモジュールを責務別に分けるが、マイクロサービス化しない。Redis、メッセージブローカー、WebSocket、常時集計workerは必須にしない。

Web UIのフレームワークは未決。暫定案は**TypeScript + React + Viteの静的フロントエンド**をFastAPIと同一originで配信する構成。過去にNext.js案は出たが、ユーザーが確定させたとは扱わない。APIの契約が同じなら、別のWeb実装でもよい。

---

<a id="s06"></a>

## 06. Androidアプリの画面・状態・基本操作

### 6.1 Reader [確定した配置を具体化]

```text
┌────────────────────────────────┐
│ ←   →    Wikipedia      検索  ⋮ │
├────────────────────────────────┤
│ 必要なときだけ薄い状態表示       │
│                                │
│                                │
│      Wikipedia WebView         │
│      本家の記事表示を使う        │
│                                │
│                                │
├────────────────────────────────┤
│       Reader       Account     │
└────────────────────────────────┘
```

上部・下部のナビゲーションはNative。記事の本文・脚注・本家のメニュー等はWikipediaの表示を使う。MVPではWikipedia側のヘッダーや検索UIをDOM改変で消さない。アプリの検索は追加の入口として提供する。

| 操作 | 振る舞い |
|---|---|
| 戻る | `canGoBack()`に連動。履歴がないときは無効 |
| 進む | `canGoForward()`に連動。履歴がないときは無効 |
| 検索 | Reader上に検索画面を開く。WebViewの履歴は変えない |
| メニュー | 再読み込み、ブラウザで開く、URL共有、記録停止、状態修正等 |
| Readerタブ | 保持していたReaderへ戻る |
| Accountタブ | WebViewを再読み込みせずAccountへ切り替える。計測は停止 |

進捗の常時オーバーレイや読了演出は初期では控えめにする。「同期が止まった」「記録停止中」など、ユーザーが知る必要のある状態だけを小さく表示する。通知音や頻繁なトーストは出さない。

#### メニュー案

```text
再読み込み
現在の記事をブラウザで開く
URLを共有
この記事の状態を変更
この記事の記録を削除
記録を一時停止 / 再開
```

削除・詳細な公開設定はDashboardへ移してもよいが、Readerからその操作に到達できるようにする。

### 6.2 Search

独立した検索画面として扱う。下部タブは増やさない。表示中はReaderの読書時間を加算しない。詳細は次章。

### 6.3 Account [確定]

```text
┌────────────────────────────────┐
│ Account                        │
├────────────────────────────────┤
│ 表示名                         │
│ 連携済み / 未連携               │
│                                │
│ 閲覧記事数           42        │
│ うち読了             12        │
│ アクティブ閲覧時間   5時間32分  │
│ 推定読書文字数       128,421   │
│                                │
│ 同期済み / 未送信 3件           │
│ 記録を一時停止                 │
│                                │
│ [ Dashboardを開く ]            │
│ [ ログアウト / 端末連携解除 ]   │
├────────────────────────────────┤
│       Reader       Account     │
└────────────────────────────────┘
```

数字は架空のUI例。Accountにタイムライン、Neighbours、複雑なグラフ、称号一覧のすべてを移植しない。これらはDashboardを入口にする。

未連携時はGoogle/GitHubへのログイン導線、記録開始の説明、Dashboardへの導線を出す。Xの未実装ボタンは出さない。

### 6.4 初回起動 [設計案]

「読む・検索する」は未ログインでも利用可能とし、**サーバーへ読書記録を送るのはログイン・計測同意後だけ**とする。ログイン前に蓄積した隠れた読書履歴を、ログインした瞬間に遡って送らない。

最初の検索先は端末言語が日本語なら日本語、それ以外は英語を仮置きする。最初のReader URLは対象wikiのトップページとし、検索は1タップで開けるようにする。トップページは読書実績にしない。

「最近見た記事」などの端末内保存も初回に説明し、同意前は保存しない。未ログインでも端末内履歴の保存だけに同意でき、消去・保存停止ができるようにする。端末内保存とクラウド記録への同意は混同しない。

### 6.5 Androidの戻る操作

OSの戻る操作は次の順で処理する。

```text
キーボードが表示中 → キーボードを閉じる
ダイアログが表示中 → ダイアログを閉じる
検索画面が表示中   → 検索を閉じ、元のReaderへ
Accountを表示中    → Readerへ
Readerに戻る履歴あり → WebView.goBack()
それ以外             → Android標準のルート画面の戻る動作
```

上部の戻るボタンはWebView履歴専用とし、履歴がないのにアプリ終了ボタンへ変えない。

---

<a id="s07"></a>

## 07. 検索画面の詳細仕様

### 7.1 UIの方向性 [確定と設計案]

検索に関しては、記事表示以上にアプリ側で使いやすさを作る。画面は余白のある検索欄、言語選択、整理された候補リストを中心にする。

```text
┌────────────────────────────────┐
│ ←  Wikipediaを検索…        ×  │
│     [ 日本語 ] [ English ]     │
├────────────────────────────────┤
│ 最近見た記事                   │
│  記事タイトル                  │
│  記事タイトル                  │
│                                │
│ 最近検索した記事               │
│  記事タイトル                  │
│  記事タイトル                  │
└────────────────────────────────┘
```

入力中：

```text
┌────────────────────────────────┐
│ ←  検索語                  ×  │
│     [ 日本語 ] [ English ]     │
├────────────────────────────────┤
│ タイトル候補                   │
│  記事タイトル                  │
│  短い説明文                    │
│                                │
│  別の記事タイトル              │
│  短い説明文                    │
│                                │
│ 「検索語」で本文も検索する      │
└────────────────────────────────┘
```

検索確定後は同じ画面で全文検索結果に切り替える。「候補」と「本文も含めて検索した結果」を混ぜず、状態を明確にする。

#### 見た目の初期方針 [設計案]

Material 3を土台とし、システムのライト/ダークに追従。タイトルを主、説明を従にする。説明は2行程度まで。画像は必須にせず、**MVPはテキスト中心**でよい。ブランド色・ロゴ・装飾の最終決定は未決。

タップ領域は48dp以上を設計目標とし、TalkBack用ラベル、十分なコントラスト、大きな文字設定を考慮する。長い日本語・英語タイトルでも横にはみ出さない。

### 7.2 検索状態

```text
empty
  ├─ 入力確定 → suggesting
  └─ 履歴記事を選択 → Reader

suggesting
  ├─ 候補を選択 → Reader
  ├─ 検索実行 → searching → results
  ├─ 入力変更 → suggesting
  └─ 入力消去 → empty

results
  ├─ 結果を選択 → Reader
  ├─ 入力変更 → suggesting
  ├─ 言語変更 → 同じクエリで再検索
  └─ 入力消去 → empty
```

読み込み中、0件、通信エラー、オフラインはそれぞれ別の表示状態にする。エラーを「検索結果なし」と表現しない。

### 7.3 入力UX [方針確定、数値は設計案]

| 項目 | 初期仕様 |
|---|---|
| 0文字 | 最近見た記事・最近検索した記事 |
| 1文字以上 | オートコンプリート候補の対象 |
| debounce | 300ms |
| IME変換中 | 原則として問い合わせず、確定後に候補更新 |
| 候補件数 | 最大10件 |
| Enter / IME検索 / 検索行タップ | 本文を含む検索を実行 |
| 全文検索初期件数 | 上位20件 |
| 入力消去 | 直ちにゼロ入力状態へ戻る |
| 言語変更 | クエリを維持し、選択言語へ再問い合わせ |

300ms、10件、20件は使って調整する仮置き。日本語で「2文字以上」などの不要な制約を課さない。

通信キャンセルと結果の世代管理を両方行う。`(language, query, mode, request_id)`が現在の検索状態と一致する結果だけ表示し、遅れて返った古い日本語の結果が英語画面に上書きされないようにする。

確定クエリは前後の空白を除去する程度とし、独自の先頭大文字化や意味を変える過度な正規化は行わない。

### 7.4 言語選択

検索画面に日本語・Englishの2択を置く。通常のReaderトップバーに言語の選択UIは置かない。

検索を開くときは、現在の記事の言語が判別できればそれを初期選択にする。それ以外は前回検索した言語を使う。言語を選んだだけでは、背後のReaderの記事は移動させない。

**同じ記事の翻訳先を開く機能ではない。** その言語を検索する操作である。日本語タイトルのまま英語wikiへURLを組み替えない。

### 7.5 ゼロ入力の2種類の履歴 [意味を具体化する設計案]

| 項目 | 登録のタイミング | 保存先 |
|---|---|---|
| 最近見た記事 | 通常記事がReaderで正常表示された時 | 端末内 |
| 最近検索した記事 | 候補または全文検索結果から記事を選んだ時 | 端末内 |

「最近検索した記事」は、**候補に出ただけの記事でも、途中まで入力した文字列でもない**。任意の検索語の履歴はMVPでは保存しない。

最近見た記事には短時間で閉じた記事も載り得るが、読書実績の「閲覧記事数」とは別のナビゲーション用履歴である。この違いをデータ名でも分ける。

各種履歴は直近20件を仮置きし、同じ`(wiki, page_id)`は新しい方へ移動させる。ゼロ入力時は選択中の言語の履歴を優先表示する。初期表示は各5件程度、残りは展開でよい。

保存先はアクティブなwikimfアカウント別に分け、未ログインはゲスト枠とする。アカウントを切り替えたときに他人の履歴を見せない。MVPでは端末間同期しない。各行削除、全消去、保存停止を用意する。

Wikipedia側の未確定記事IDはローカルURLで一時識別し、解決後に統合する。端末内履歴の表示をクラウド同期の完了まで待たせない。

### 7.6 Wikipedia API [外部仕様と採用案]

オートコンプリートはMediaWiki REST APIのタイトル検索、本文を含む検索はページ検索を使用する。公式リファレンスに両方のエンドポイントが定義されている。[^W2]

```http
GET https://ja.wikipedia.org/w/rest.php/v1/search/title?q={query}&limit=10
GET https://ja.wikipedia.org/w/rest.php/v1/search/page?q={query}&limit=20

GET https://en.wikipedia.org/w/rest.php/v1/search/title?q={query}&limit=10
GET https://en.wikipedia.org/w/rest.php/v1/search/page?q={query}&limit=20
```

AndroidのNative HTTPクライアントから直接問い合わせる案を採用する。ユーザーの文字入力をすべてwikimfサーバーへ送る検索proxyは、MVPでは作らない。検索先のWikipediaにはクエリが送信されることをプライバシー説明に含める。

応答の`id`、`key`、`title`、`description`、`excerpt`等を自分たちの`SearchHit`モデルへ変換する。`description`や画像は欠けても表示できるようにする。検索結果のHTML断片をWebViewとして実行せず、テキストとして安全に表示する。[^W2]

「完全な検索」は**タイトルだけでなく本文も検索する**という意味であり、MVPで無制限に全件取得する意味にはしない。上位20件表示で開始し、必要なら件数を増やす。ページングが必要になった際はAction APIの検索とcontinuation等を別途採用し、RESTに未確認のoffsetパラメータを捏造しない。[^W2][^W3]

検索APIの障害時は、端末内の最近の記事を選択可能にし、再試行ボタンと「Wikipedia本家の検索を開く」を用意する。本家の検索結果ページ自体は読書計測対象外。

---

<a id="s08"></a>

## 08. URL・記事遷移・外部ブラウザの境界

### 8.1 トップレベル遷移の許可先 [確定方針を具体化]

```text
https://ja.wikipedia.org
https://en.wikipedia.org
```

この2つのoriginの通常ページをReader内で表示する。`www.wikipedia.org`、他言語版、Wikimedia Commons、外部の出典サイト等は、初期の内蔵Readerの対象外とする。

判定はURL parserによるscheme、host、portの比較で行う。文字列の`contains("wikipedia.org")`、安易な前方一致・後方一致は使わない。

```text
ja.wikipedia.org.example.com → 不許可
user@ja.wikipedia.org        → 認証情報付きURLとして拒否
http://ja.wikipedia.org      → 初期仕様では外部扱い。アプリ内へはHTTPSのみ
https://ja.wikipedia.org:8443 → 不許可
```

外部リンクを開くのはユーザーが押した場合に限り、無人のリダイレクト・popupから外部アプリが次々に起動する動作は認めない。HTTPS/HTTPの外部Web URLはホスト名が分かる形で既定ブラウザへ渡す。初期は確認ダイアログを出す案とする。

`javascript:`、`data:`、`file:`、任意の`intent:`等を外部アプリへの万能起動口にしない。`mailto:`等の非Web scheme対応は後続にし、MVPでは説明を出して拒否する。

### 8.2 表示許可と計測許可は別

対象wiki内でも、検索、カテゴリ、履歴、差分、編集、ログイン等を読書実績に入れない。

| 種類 | 表示 | 計測 |
|---|---|---|
| 通常の現行記事 | Reader | 条件を満たせば実施 |
| 本家の検索・カテゴリ等 | Reader内表示可 | しない |
| 履歴・差分・旧版 | 表示可 | しない |
| 編集・Wikipediaログイン | MVPの保証対象外。外部ブラウザへの導線 | しない |
| 他言語・他サイト | 外部ブラウザ | しない |

Readerがどのページを表示できるかと、記事namespace・版などの計測条件を一つのif文にまとめない。

### 8.3 サブリソースは別の扱い

上記の2ホスト制限は**トップレベルのページ遷移とNative bridge公開先**の規則である。画像、CSS、フォント等まで一律に2ホストへ制限して表示を壊さない。

JS bridgeを画像配信origin等へ公開する必要はない。サブリソースの通信を許すことと、Nativeの機能を公開することを混同しない。任意のHTTPS画像等が存在しても、Reader外のサイトを計測しない。

### 8.4 新規ウィンドウ・リダイレクト・アンカー

`target="_blank"`等も同じURL検査を経由し、許可wikiなら現在のReader内で開く。外部ならブラウザへ渡す。計測bridgeを持つ無制限の子WebViewは作らない。

HTTPリダイレクト後の最終URLでも計測対象を再確認する。開始URLが許可先でも、遷移先が許可先とは限らない。

同一記事内の`#section`移動ではReadingSessionを増やさず、記事数も増やさない。ブラウザの前後履歴にアンカーが載る動き自体はWebViewの標準挙動を尊重する。

### 8.5 ブラウザで開いた後

外部ブラウザへ移る直前に計測を停止し、保存可能な観測をOutboxへ入れる。戻ったら現在のReader画面・フォーカス・URLを確認して再開する。

「ブラウザで開く」はWikipedia記事でも利用できる。ただしAndroidの通常ブラウザで読んだ続きが自動でwikimfへ記録されるとは表示しない。

---

<a id="s09"></a>

## 09. Android実装とWebViewの安全な境界

### 9.1 技術構成 [設計案]

| 責務 | 候補 |
|---|---|
| UI | Kotlin / Jetpack Compose |
| WebView連携 | AndroidX WebKit |
| HTTP / JSON | OkHttp + kotlinx.serialization |
| ローカルキュー・履歴 | Room |
| 小さな設定 | DataStore |
| 再送の実行契機 | フォアグラウンド処理 + WorkManager |
| 秘密情報保管 | Android Keystoreで保護する鍵を使った暗号化保存 |
| 共有計測 | TypeScriptをbundleした同梱JavaScript |

ライブラリの具体バージョン、minSdk、targetSdk、Gradle構成は未決。実装開始時に安定版の組合せを固定し、lockfileやバージョンカタログで再現可能にする。本書は特定バージョンが最新版だとは主張しない。

### 9.2 WebViewの管理

Composeの再描画のたびにWebViewを生成・`loadUrl()`しない。URLの変更と通常のrecompositionを分離する。

Reader↔Accountの切替では閲覧位置・前後履歴を保持する。画面回転などの構成変更はWebView状態の保存・復元を実装するが、Activityを長寿命のViewModelへ保持してリークさせない。プロセス終了からの復帰は新しいセッションとする。

`onPageStarted`のみで読書を開始しない。最終URL、本文の準備、記事解決、同意、可視性が揃ってから計測する。途中でレンダラが停止した場合は計測を止め、再読み込みUIを出す。

### 9.3 tracker注入・メッセージ受信 [外部仕様と採用案]

AndroidX WebKitには、originを指定したJavaScript注入とWebメッセージリスナーがある。機能の利用可否は`WebViewFeature.isFeatureSupported`で確認し、対応機能を前提に初期化する。[^W4]

- 同梱のtrackerを使う。サーバーから任意のJavaScriptを配って実行しない。
- 注入対象originは日本語・英語の2つに限定する。
- main frame以外ではtrackerを起動しない。
- 受信時にも`sourceOrigin`と`isMainFrame`等を検証する。
- 最大payload長、JSON schema、送信頻度、session対応を検証する。
- 必須の安全なbridgeが使えない場合は計測を無効化し、Readerは利用可能にする。
- document-start注入が使えない場合の遅延注入は、未計測時間を遡及加算しない。

起動順序や使用可能なAPIは実装時に固定バージョンで確認する。WikipediaのDOMが未準備のdocument-start処理は、初期化だけ短く行う。

### 9.4 bridgeの権限を極小化する

Wikipediaは許可originだが、自分たちが管理するページではない。origin制限だけで「tracker以外から絶対に呼ばれない」とは考えない。Native bridgeの機能は**観測メッセージを渡すこと**だけに絞る。

禁止する例：

```text
トークンを返す
任意URLをfetchする
任意ファイルを読む
任意Intentを起動する
認証情報やCookieを返す
任意ユーザーの履歴を取得する
```

アクセストークン、端末トークン、Google/GitHubの秘密情報をWebViewやtrackerへ渡さない。Wikipedia本文のJSから、wikimfのAPIを代理実行できる構造にしない。Android公式もNative bridgeの公開範囲と入力の扱いに注意を求めている。[^W5]

### 9.5 安全な初期設定 [設計案]

SSLエラーを無視して続行しない。file access、file URLからの横断アクセス、混在コンテンツ、WebViewデバッグ等は必要最小限とし、デバッグは開発ビルドのみ。ダウンロードやファイル選択はMVPの保証機能に含めない。

WikipediaのCookieとwikimfの認証状態は分離する。Dashboardや認証画面を、計測bridge付きのWikipedia WebViewへ混在させない。Dashboardと認証は外部ブラウザで開く。

### 9.6 計測のホスト条件

Android側のHost Adapterは、少なくとも以下をtrackerへ渡す。

```text
Readerが前面で表示されているか
アプリ/ウィンドウが操作対象か
検索・Account・ダイアログで覆われていないか
記録への同意と一時停止状態
端末側の単調時計・セッション情報
```

ページの`visibilityState`だけに依存しない。Readerを覆うNative検索画面は、ページのDOMだけでは正しく把握できないためである。

---

<a id="s10"></a>

## 10. Chrome拡張の設計

### 10.1 対象と表示

MVPはデスクトップChrome向けManifest V3。日本語版と英語版Wikipediaに限定する。

```text
content script
    本文観測、tracker実行
        ↓
service worker
    sender検証、タブ調停、認証、Outbox、同期
        ↓
FastAPI
```

本家UIを変更しないことを標準とする。popupで現在の記事状態、記録ON/OFF、同期状態、Dashboardへのリンクを表示する。常設の大きなUIやポップアップ演出は後続。

### 10.2 対象URL

```text
https://ja.wikipedia.org/wiki/*
https://ja.wikipedia.org/w/index.php*
https://en.wikipedia.org/wiki/*
https://en.wikipedia.org/w/index.php*
```

top frameだけで実行し、起動後にnamespace、action、diff、oldid等で計測対象を絞る。`/wiki/*`であれば必ず記事であるとは扱わない。

### 10.3 isolated world

Chromeのcontent scriptはページとDOMを共有できるが、通常はJavaScriptの実行環境が分離されている。ページ側の`window.mw`がそのまま読める前提にしない。[^W6]

共通trackerは本文DOMとURLなどを扱う。記事の正規IDはBackendのArticle Resolverで確定する。ページ側のJSグローバル変数に依存する実装を初期の唯一の手段にしない。

### 10.4 タブの同時計測

同じブラウザ内で、focused windowのactive tabだけが時間を加算できる短期leaseを持つ案とする。

- lease更新目安10秒、有効15秒。
- hidden/blur、タブ変更、window変更で直ちに停止。
- worker再起動時は現在のタブ・window状態から復元する。
- 長い接続や常駐タイマーだけでworkerが生き続ける前提にしない。

service workerは停止・再起動が起こるため、永続状態をメモリにしか持たせない設計は避ける。[^W7]

### 10.5 権限と認証

基本は対象Wikipediaページのcontent scripts、wikimf API originへの通信、storage、alarmsに絞る案。history、cookies、全サイトアクセスは要求しない。タブのURL等の不要な情報を読むためだけに権限を追加しない。

workerはmessageのsender、拡張ID、frame、tab、許可URLを確認する。content scriptから任意URLを渡して代理fetchできるAPIを作らない。

トークンはtrusted extension contextの保管領域に置き、content scriptへ渡さない。設定・永続キュー・秘密情報の保管領域を分ける。拡張機能の保存APIにはcontextごとのアクセス制御があるため、採用方法を実装時に明示する。[^W8]

### 10.6 一時停止と非対応ケース

Incognitoでの記録は初期では無効。対象外ページ・本文抽出失敗・同期エラーを読了と誤表示しない。

「記録停止」はwikimfへの収集・同期の設定であり、Chrome自身やWikipedia側の履歴・Cookie等を消す機能ではない。

---

<a id="s11"></a>

## 11. 記事識別・逆引き・表示版の扱い

### 11.1 記事の正規キー [確定]

```text
UNIQUE(wiki, page_id)

例：
("jawiki", 12345)
("enwiki", 67890)
```

IDは架空の説明値。`page_id`の一致だけで別wikiの記事を同一視しない。ユーザー向けタイトル、canonical URLは属性であり主キーではない。

Article表の内部主キーにはUUIDの`article_id`を使い、正規キーに一意制約を設ける。

### 11.2 解決処理

入力は許可されたWikipedia URL、または`wiki + page_id`。`/wiki/{title}`、`/w/index.php?title=...`、`/w/index.php?curid=...`を解釈する案とし、fragmentは記事同一性から外す。page IDは正の整数とし、不正なpercent encoding、複数の矛盾した識別子、未知のwikiは拒否する。URLを受け取る場合も任意URLへfetchせず、検査したwikiとタイトル等から固定APIへ問い合わせる。

MediaWikiのQuery APIは、タイトル・page ID等による取得、正規化、redirect解決などの入口になる。[^W9]

```http
GET https://ja.wikipedia.org/w/api.php
    ?action=query
    &format=json
    &formatversion=2
    &pageids={page_id}
    &prop=info|pageprops
    &inprop=url
    &redirects=1
```

実際のURLはHTTPクライアントでパラメータをエンコードする。タイトル解決時は`pageids`の代わりに`titles`を用いる。

missing、redirect、namespace、曖昧さ回避、canonical title / URLを扱う。API失敗を「記事が存在しない」に変換しない。

### 11.3 IDからの逆引き [確定機能・パスは設計案]

| API | 用途 |
|---|---|
| `GET /api/v1/articles/{article_id}` | wikimf内部UUIDから取得 |
| `GET /api/v1/wikis/{wiki}/pages/{page_id}` | Wikipedia側IDから取得。未登録なら解決して登録 |
| `POST /api/v1/articles/resolve` | URL等から正規記事へ解決 |
| `POST /api/v1/articles/batch-get` | 履歴・画面表示用に複数UUIDを取得 |

`GET`の逆引きでキャッシュの補充をしても、読書状態や記事数は変更しない。取得できるのは公開のWikipediaメタデータのみ。ユーザーの閲覧有無や統計を公開APIへ混ぜない。

外部APIが落ちていてキャッシュがある場合は、`metadata_status="stale"`と更新日時を返せるようにする。未キャッシュなら再試行可能なエラーを返す。

### 11.4 redirect・改名・削除

通常の改名は同じpage IDに追従する。タイトル変更によって読書履歴を重複作成しない。削除・再作成等でIDが異なるものを、タイトル一致だけで以前の記事と同一視しない。[^W9]

redirect元はaliasesとして扱えるが、canonical記事との対応を保存する。後日のredirect変更で過去の全履歴を無言で別記事へ書き換えない。履歴には観測時のタイトルを残し、表示用の現行タイトルと区別する。

### 11.5 revisionとfingerprint

```text
article.page_id                 = 記事の識別
article.latest_revision_id      = サーバー取得時点の最新revision（参考）
session.observed_revision_id   = 実際の表示版として確認できたもの（nullable）
session.document_fingerprint   = 抽出した本文の変化検知用hash
session.extractor_version      = 抽出方法
```

「今APIで最新だったrevision」を、そのユーザーが実際に見ていたrevisionとして保存しない。実際の表示版を確実に取得できない場合は`observed_revision_id = null`とする。

fingerprintは本文変化の検知用であり、Wikipedia公式本文の真正性や人間の読書を証明するものではない。

「前に読んだ後で更新された」という機能は後続。本書では最新revisionとの差分通知や差分本文の保存を要求しない。

---

<a id="s12"></a>

## 12. 共通trackerと読書行動の観測

### 12.1 観測対象 [設計案]

対象は通常の記事namespaceの現行表示。記事検索、特殊ページ、カテゴリ、ノート、編集、差分、旧版、メインページ、曖昧さ回避ページは自動実績の対象外とする案。

対象外をタイトル中のコロンだけで判定しない。Backendのnamespace等の結果と、表示URLのmodeの両方を使う。記事一覧など本文抽出が難しい通常記事は、抽出できなければ時間のみ記録する。

### 12.2 抽出器

`#mw-content-text .mw-parser-output`等を入口候補として、スキンや言語を吸収する**version付きDOM adapter**を作る。特定selectorがいつまでも同じと保証する設計にはしない。

初期の文字数対象は本文段落と本文リスト。ナビゲーション、目次、編集リンク、infobox、参考文献、脚注一覧、ギャラリー、テンプレートの案内部分等を除外する。これは「Wikipediaに存在する全テキストの文字数」ではなく、**wikimfが計測対象と定義した本文文字数**である。

モバイル表示で折りたたまれた本文セクションは、構造として抽出できるなら分母に含め、開いて表示されるまでcoveredにしない。装飾上の隠し要素を除くことと、折りたたまれた本来の本文を分母から消すことは分ける。

本文の取得・分類に確信が持てないときは`measurement_status="time_only"`にする。推定100%や0文字読了を生成しない。

### 12.3 文字数とchunk

空白を除去したUnicode code point数を初期の文字数定義とする。JavaScriptのUTF-16 `string.length`をそのまま文字数と呼ばない。句読点は含める。英語の単語数とは別指標である。

段落等を約200 code pointごとのchunkへ論理分割する。元DOMを大量のspanで囲み直さず、text nodeとRangeへの参照で観測する案。

```text
本文3,000文字
  → 約200文字 × 15 chunks
```

長い段落全体の「50%可視」だけで判定しない。画面に収まらない要素では条件を満たせなくなるため、chunk単位で扱う。

### 12.4 カバー率

chunkのRange矩形とviewportの交差から可視割合を計算し、**アクティブ時間中に50%以上が累計2秒以上表示**されたchunkをcoveredにする案。

```text
covered_chars = coveredになったchunkの文字数の合計
coverage = covered_chars / text_chars
```

同じchunkを何度見ても、同一sessionのcovered文字数は増やさない。Endキーで末尾へ飛んだ際に中間のchunkをcoveredにしない。

矩形は必要な周辺だけを評価し、scrollやresizeごとに全記事を同期測定しない。`IntersectionObserver`等は候補領域の絞り込みに使い、詳細測定は間引く。画像読込・文字サイズ・zoomによるレイアウト変化を考慮する。

画面に表示されたことは、視線がそこに向いていたことを意味しない。他の要素による完全な遮蔽や音声読み上げも、この初期方式では正確に扱えない。アクセシビリティ利用者には手動の状態変更を用意する。

### 12.5 アクティブ閲覧時間

加算条件をすべて満たす時間だけ計測する。

```text
計測への同意がある
停止中でない
対象の記事・画面である
documentがvisible
Host Adapterが計測可能と判定
直近の有効な操作からidle上限内
単調時計の差分が正常
```

初期idle上限は60秒。scroll、wheel、pointerdown、touch、keydown等を操作として扱うが、キーの中身、入力文字、フォームの値は記録しない。pointermoveだけで延々と延長しない。初回の表示・focusに60秒の猶予を与える案。

1秒程度のtickで単調時計の差分を評価し、2秒を超える大きなgapはsleepや処理停止として加算せず、基準を更新する。hidden、blur、検索画面、Account、外部ブラウザ、画面ロックで直ちに停止する。

60秒idleは調整値であり、長く静かに読む人を過小評価する。読書速度・身体操作・端末状態の違いを正確に判定する仕組みだとは説明しない。

### 12.6 文書・セッションの切り替え

| 変化 | セッション |
|---|---|
| 同一記事のアンカー移動 | 維持 |
| zoom / resizeだけ | 維持して矩形を再計算 |
| Reader→検索→Reader | 同じDocumentなら維持し、その間の時間は除外 |
| 別記事への遷移 | 新規 |
| reload / 新規タブ | 新規 |
| 計測対象の本文内容が変わる | 新規Document / session |
| trackerの抽出定義が変わる | 新規 |
| BFCacheから同一Documentが戻る | seq・計測状態を安全に復元できれば維持 |
| アプリ/ページプロセスを失った後 | 新規 |
| ログインユーザー変更・時計異常 | 新規 |

本文変更検知はナビゲーションや装飾のMutationまで拾って無限にセッションを切らない。抽出した本文の変化に限定する。閉じたことを表すイベントが届かなくても集計できる設計とする。

### 12.7 推定読書文字数

```text
session_estimated_chars =
  min(
    covered_chars,
    floor(accepted_active_ms / 60000 × chars_per_minute[language])
  )
```

言語別の仮置き：

| 言語 | 初期の上限係数 |
|---|---:|
| 日本語 | 600 code points / 分 |
| 英語 | 1,000 code points / 分 |

日本語600は添付案を引き継ぐ仮説、英語1,000は本書の追加提案。**人間の標準読書速度の研究値ではない。** 英語について同じ600を使うかも含め、実利用のfixtureで調整する。

この式は時間による上限であり、実際に読まれた各文字を確定する式ではない。「ある場所で長く滞在してから他を流し見る」といった挙動も完全には防げない。最初から不正検知を機械学習化せず、個人の記録として使う。

---

<a id="s13"></a>

## 13. 閲覧・途中まで読んだ・読了の判定

### 13.1 UIの状態 [確定]

```text
viewed      閲覧
partial     途中まで読んだ
completed   読了
```

ユーザーが記事を開いた直後には、まだどの記録状態にも入っていなくてよい。内部の`pending`や`measurement_status`は処理状態であり、ユーザー向けの第4、第5の読書状態ではない。

「読了」の補助説明には「自動推定」または「自分で設定」を表示できるようにする。読了という短いラベルを使っても、機械が理解度を確認したと誤認させない。

### 13.2 自動判定v1 [すべて調整可能な設計案]

Nを本文文字数、Cをcovered文字数、Tをサーバーが計上したアクティブ秒、Rを言語別の文字数/分の上限係数とする。

| 優先順 | 状態 | 条件 |
|---|---|---|
| 1 | 読了 | 本文抽出成功、N>0、C/N≥0.8、T≥max(30, 60×0.8×N/R) |
| 2 | 途中まで読んだ | 読了条件未達、本文抽出成功、T≥30、C≥min(200,N) |
| 3 | 閲覧 | T≥10 |
| それ以外 | 履歴の読書実績に未登録 | 起動中の一時状態や短時間離脱 |

本文抽出失敗時は時間を記録できるが、自動でpartial/completedにはしない。時間が十分だから読了、と飛躍しない。

partialに本文全体の一定割合を強制しないのは、非常に長い記事の一節だけを読んだ行動も「途中まで読んだ」にしたいため。30秒・200文字という値は暫定である。

```python
# 仕様を示す擬似コード。実装では整数演算と境界テストを用いる。
def infer_state(active_seconds, text_chars, covered_chars, rate, measurement_ok):
    if measurement_ok and text_chars > 0:
        coverage = covered_chars / text_chars
        minimum_completed_seconds = max(
            30,
            60 * 0.8 * text_chars / rate,
        )
        if coverage >= 0.8 and active_seconds >= minimum_completed_seconds:
            return "completed"
        if active_seconds >= 30 and covered_chars >= min(200, text_chars):
            return "partial"

    if active_seconds >= 10:
        return "viewed"
    return None
```

例として日本語本文3,000文字なら、2,400文字以上のcoverと4分以上で読了。300文字なら、240文字以上のcoverと30秒以上になる。これは上記の仮ルールによる計算例であり、実測による正しさを主張しない。

### 13.3 session状態と記事状態

sessionごとの状態は、その回の行動を表す。記事ごとの自動状態は、削除されていないsessionのうち最も進んだ状態を基本とする。

```text
前回：読了
今回：10秒だけ確認
  → 今回の活動は閲覧
  → 記事の到達状態は読了のまま
```

MVPでは異なるsession・版・端末のcovered chunkを合成して読了判定しない。半分ずつ別の日に読んだ場合の自動読了は過小評価され得るが、分割読書を不正確に100%へ合成するより安全な初期仕様とする。手動設定で補える。

### 13.4 手動設定 [設計案]

ArticleReadingStateに以下を別々に保持する。

```text
inferred_state
manual_state（nullable）
manual_updated_at
effective_state
```

手動で閲覧・途中まで読んだ・読了を選べる。`manual_state`があるときはそれを表示し、「自分で設定」と分かるようにする。手動設定を消すと自動判定へ戻る。

手動設定しても時間、coverage、推定文字数を捏造しない。手動読了のために架空のReadingEventを生成しない。自動で状態を戻して本人の操作を勝手に上書きしない。

### 13.5 判定変更と版の扱い

`measurement_policy_version`と`server_policy_version`を保持する。閾値変更を単に設定ファイルの書き換えで過去全件に無言適用しない。

初期案は新しい記録から新ルールを使い、過去は旧判定を保持。過去の再計算は明示的なmigration/jobにし、対象期間と変更理由を残す。削除に伴う再計算では、各記録の元の判定versionを使う。

---

<a id="s14"></a>

## 14. 集計・再読・複数端末・称号

### 14.1 指標の定義

| UI指標 | 定義 |
|---|---|
| 閲覧記事数 | 有効な自動閲覧条件を一度以上満たしたArticleのDISTINCT数 |
| 状態別記事数 | Articleごとのeffective_stateで分けた3状態の数 |
| 読了記事数 | effective_stateがcompletedの記事数。自動/手動の内訳も取得可能 |
| 読書活動数 | 閲覧条件を満たしたReadingSessionの数 |
| アクティブ閲覧時間 | 有効な自動閲覧条件を満たしたsessionに割り当てた時間区間の和集合。10秒未満の途中観測は条件到達まで投影しない（実装契約ADR 0001） |
| 推定読書文字数 | 記事ごとのsession推定文字数の最大値を合計する初期定義 |
| 最近の読書 | qualified sessionの時系列。観測heartbeatを並べない |

「閲覧記事数」はpartial/completedも含む入口のユニーク数として使う。状態別の`viewed`件数は「閲覧のみ」と表示し、同じ言葉で二つの意味を持たせない。

手動で記録しただけの記事は読了記事数等に含められるが、**自動の閲覧記事数・時間・文字数へ混入させない**。Dashboard APIは`recorded_article_count`、`qualified_article_count`等を分けて返す。

### 14.2 Last.fm的な再訪の扱い

同じ記事を再び読むこと自体は価値がある。再読の活動履歴と時間は残す。一方、記事の種類数は重複加算しない。

```text
同じ記事を3回読む
  活動履歴：3件（3sessionとも条件を満たした場合）
  記事の種類数：1件
  時間：実際の計上可能時間を合計
  初読相当の推定文字数：最大のsession推定値
```

この推定文字数は「一生に画面で読んだ全ての文字の延べ数」ではない。UIには「再読を重複加算しない推定値」という説明を置く。必要なら将来、別指標として延べ推定文字数を追加する。

期間別の推定文字数は、当該期間に増えた記事別最大値の差分を表示する案とする。全文字数を閲覧のたびに今日へ付け替えない。再計算できるよう、最大値を更新した時刻または増分ledgerを残す。期間への割当はサーバー到着日ではなく検証済みの観測時刻順で計算し、遅れて届いた記録がある場合は影響する期間の増分を再計算する。

### 14.3 時間区間の和集合

同じユーザーがPCとAndroidで同時刻に計測しても、総時間を二倍にしない。

```text
PC      12:00:00〜12:01:00
Android 12:00:30〜12:01:30

総時間 = 90秒
```

この例は計算規則を示す架空データ。クライアントのUTC時刻には誤差があるため、完全な実時間の証明ではない。

記事別時間と総時間を一致させるため、異なる記事の重複区間は、**最初にサーバーが受理した有効区間**へ割り当てる案。`received_at`とイベントID等で処理順を固定し、再計算でも同じ順にする。記事ごとの時間のsumと総時間の不整合を放置しない。

MVPにはPCとAndroidがあるため、同一端末のタブ調停だけで終了しない。重複時間の処理を大規模なストリーム基盤にせず、同一ユーザーの短い区間をトランザクション内で計上する。

### 14.4 保守的な集計

- coverageは対象session内のcovered集合で復元する。
- 時間は検証済みのintervalから計算する。
- 累積`active_ms_total`だけで未着区間を補間しない。
- 矛盾する観測は隔離し、見かけ上の100%を作らない。
- 不完全な同期は明示し、過大計上より過小計上を選ぶ。

### 14.5 称号 [初期ルールは設計案]

最初は3種類程度の固定ルールでよい。

| 系列 | 例の条件 | 根拠 |
|---|---|---|
| 読書の足跡 | 閲覧条件を満たした記事が10種類 | qualified article数 |
| 継続した読書 | アクティブ閲覧時間の累計60分 | 計上時間 |
| 二つの言語 | 日本語・英語で各1件以上の読書活動 | 記事のwiki |

名称・閾値は仮。ジャンル別称号や「他人の上位何%」は、カテゴリ分類や母集団が未整備なので作らない。手動状態だけで自動計測の称号が増えないよう、根拠指標を明記する。

称号は初期では派生表示とし、削除後は条件を再評価する。汎用的なルールエンジンや複雑なイベント駆動の授与システムは導入しない。

---

<a id="s15"></a>

## 15. 共通イベント契約

### 15.1 基本原則 [形式統一は確定、フィールドは設計案]

```http
POST /api/v1/reading-events/batch
Authorization: Bearer {wikimf_device_token}
Content-Type: application/json
```

AndroidとChrome拡張は同じschemaで送る。`user_id`を本文で指定させず、認証されたdeviceから決める。`device_id`と`source`も端末登録内容に一致させる。

イベント種類：

```text
session.opened
reading.observed
session.closed
```

終了イベントの到達は必須としない。手動状態変更、検索履歴、記事共有は別APIであり、ReadingEventに詰め込まない。

### 15.2 共通フィールド

| フィールド | 規則 |
|---|---|
| `schema_version` | 初期1。不明versionは受理しない |
| `event_id` | 端末生成UUID。再送で変更しない |
| `device_id` | 登録済み端末。tokenと一致 |
| `session_id` | Document単位のUUID |
| `session_started_at` | session開始時刻。UTC。同一session内で不変 |
| `seq` | session内の連番。openedは0 |
| `source` | `android_reader` / `chrome_extension` |
| `article_id` | サーバーで解決済みの内部Article UUID |
| `wiki`, `page_id` | Articleとの整合性検査用。二重の識別権威にはしない |
| `occurred_at` | 観測作成時刻。UTC |
| `interval` | 今回の観測区間と、その中のactive区間 |
| `document` | fingerprint、抽出version、本文文字数、chunk定義 |
| `progress` | 累積active、covered集合、計測状態 |
| `client_version` | 障害調査用 |
| `measurement_policy_version` | クライアントの計測規則 |
| `recording_epoch` | 履歴全消去等で古いキューを拒否する世代 |

### 15.3 観測イベントの例

次は架空のデータ。実際のWikipedia記事IDや履歴を示さない。前の5区間が存在し、6区間目までの累積時間が60秒になった例。

```json
{
  "schema_version": 1,
  "events": [
    {
      "event_id": "10000000-0000-4000-8000-000000000006",
      "type": "reading.observed",
      "device_id": "20000000-0000-4000-8000-000000000001",
      "session_id": "30000000-0000-4000-8000-000000000001",
      "session_started_at": "2026-10-04T12:00:00Z",
      "seq": 6,
      "source": "android_reader",
      "article_id": "40000000-0000-4000-8000-000000000001",
      "wiki": "jawiki",
      "page_id": 12345,
      "recording_epoch": 1,
      "occurred_at": "2026-10-04T12:01:00Z",
      "interval": {
        "start_at": "2026-10-04T12:00:50Z",
        "end_at": "2026-10-04T12:01:00Z",
        "active_spans_ms": [[0, 10000]]
      },
      "document": {
        "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "extractor_version": "prose-v1",
        "observed_revision_id": null,
        "text_chars": 1500,
        "chunk_chars": [200, 200, 200, 200, 200, 200, 200, 100]
      },
      "progress": {
        "active_ms_total": 60000,
        "covered_chunk_ids": [0, 1, 2],
        "measurement_status": "ok",
        "max_scroll_ratio": 0.42
      },
      "client_version": "0.1.0",
      "measurement_policy_version": "reading-v1"
    }
  ]
}
```

`max_scroll_ratio`は診断用で、単独では読了条件にならない。`observed_revision_id`は確認できた場合のみ設定。本文、キー入力、検索の入力途中、Cookie、パスワード、外部ページのURL、外部referrerは送信しない。

### 15.4 イベント別の差分

| イベント | 内容 |
|---|---|
| `session.opened` | seq=0、対象記事、Document、開始時刻、ゼロのprogress。空のactive区間 |
| `reading.observed` | 直前区間と累積snapshot |
| `session.closed` | 最後の区間とsnapshot、`reason`を追加 |
| すべて | 自分だけでもDocumentを識別できる情報を持つ |

`closed.reason`の初期候補は`navigate`、`reload`、`pause`、`logout`、`document_changed`。pauseで同じsessionを継続する実装ではclosedを送らず、最後のobservedとHost停止だけでもよい。**closedは到着順の締切ではない**ので、後から遅れて届く過去seqのイベントも受理対象とする。

### 15.5 intervalとsnapshot

`active_spans_ms`はinterval開始からのoffsetで表す半開区間。昇順、非重複、範囲内とする。sleepの間を一つのactive区間で埋めない。

snapshotの`active_ms_total`はクライアントの累積観測値。サーバー側の時間の正は検証済みintervalなので、欠落イベントがあると両者が一致しない場合がある。その状態を「同期未完了」として扱う。

同一sessionではfingerprint、extractor_version、text_chars、chunk_chars、article_id、session_started_at等を不変とする。変更が必要なら新sessionを発行する。

`measurement_status`の初期値は`ok` / `time_only`。`time_only`では理由コードを必須とし、`fingerprint`と`text_chars`をnull、chunk配列・covered配列を空にできる別schemaとして定義する。抽出に成功して`ok`へ変わる場合はDocumentが変わるため新sessionにする。対象外ページや停止中の時間を、time_onlyを使って実績に含めない。

`session.opened`は長さ0のintervalと空のactive配列を許可する。通常のobservedは`end_at > start_at`を要求し、active区間はその内側に収まることを検証する。

### 15.6 上限 [設計案]

1 batch最大100 events / 256KiB、1 event最大64KiB、最大5,000 chunks / 100万文字を仮置きする。どれかの上限に近づけば、送信側でbatchを分割する。本文が上限を超える記事は時間のみの計測へ降格する。

Pydanticは未知フィールドを原則拒否する。将来追加はschema versionを管理し、古いクライアントの対応期間を決める。型定義・JSON Schema・fixtureを同じCIで検証する。

---

<a id="s16"></a>

## 16. 同期・冪等性・オフライン・エラー

### 16.1 永続化を先にする

```text
DOM観測
  → immutableなイベントを確定
  → 端末内Outboxへ保存
  → サーバーへ送信
  → item単位のACK
  → ACK済みだけ削除
```

目安10秒ごと、および重要な状態変化時に保存する。ページ終了時の通信が成功することには依存しない。強制終了では直近約10秒と保存中の未確定分を失い得る。この許容損失を受入条件に含める。

AndroidはRoom、ChromeはIndexedDBに保存する案。認証tokenとOutboxを同じJSON blobへ入れない。

### 16.2 DBの重複制約

```text
UNIQUE(user_id, event_id)
UNIQUE(user_id, device_id, session_id, seq)
```

同じID/seqで同じ内容なら`duplicate`。同じID/seqで内容が異なる場合は`event_conflict`として拒否する。再送のたびにUUIDや時刻を変えない。

payload digestは定義したJSON canonicalizationから計算し、空白やキー順の違いだけで衝突扱いにしない。数値型やnullの扱いを契約で固定する。

イベント受付、session更新、時間計上、projection更新は一つのDBトランザクションで処理する。ネットワーク経由のWikipedia問い合わせは、ロックを保持するトランザクションの外で済ませる。

### 16.3 順序逆転

12→10→11の順でも受理する。covered集合はunionし、snapshotは後退させない。一方、時間はintervalの存在する部分だけを計上する。

seq順に評価したとき累積値が矛盾する等の異常があれば、そのsessionを隔離する。隔離前に計上したprojectionも再計算できるようにする。open/closedが未着でも、必要な情報があるobservedからsessionを作成できるようにする。

### 16.4 レスポンス例

```json
{
  "results": [
    {
      "event_id": "10000000-0000-4000-8000-000000000006",
      "status": "accepted"
    }
  ],
  "server_time": "2026-10-04T12:01:01Z",
  "recording_epoch": 1
}
```

| 状態 | クライアントの扱い |
|---|---|
| `accepted` | Outboxから削除 |
| `duplicate` | Outboxから削除 |
| `rejected` | 隔離し、理由を保持。無限再送しない |
| `retryable` | 同じイベントで再送 |
| HTTP 401 | token更新・再連携を待つ |
| HTTP 403 | 権限・端末失効を表示 |
| HTTP 413 | batchを分割。単体超過は隔離 |
| HTTP 422 | schema不一致。通常の通信再試行では直らない |
| HTTP 429 | Retry-After等を尊重 |
| HTTP 5xx / network failure | backoffして再送 |

batch内の一部失敗は200応答でもitemごとの結果を見る。`event_conflict`などはitem errorとして表現し、正常な別イベントまで一律に破棄しない。HTTPレベルの認証・形式エラーはrequest全体に返す。

### 16.5 オフライン

「オフライン対応」は、**表示済み記事で得られた記録を端末内に保持して後で同期すること**を意味する。Wikipedia記事のダウンロード保存やオフライン検索を実装したことにはしない。

記事IDが未解決の場合は、URLと観測をローカルのpending envelopeとして保存する。サーバーへ正式イベントを送る前に解決して固定する。すでに送った同じevent_idの中身を後から編集しない。

Outbox上限は7日または10MiBを初期案とする。上限到達時は古い記録を黙って上書きせず、新しいクラウド計測を止めて通知する。期限切れの処理と損失件数も見えるようにする。

### 16.6 再送契機と頻度

アプリが前面なら保存後にまとめて送信する。バックグラウンドではOSの実行制約に従う。WorkManagerで「必ず10秒ごとに同期」を約束しない。

Chromeはworker起動、観測受信、alarm、手動再試行などを契機にする。周期タイマーのためだけにworkerを常駐させない。

指数backoff + jitter、回復時の小さなbatch送信を使い、接続復帰時に大量の同時リクエストを投げない。

### 16.7 アカウントと時刻

Outboxの各行は作成時のアカウント・deviceに固定する。別アカウントのtokenで送信し直さない。ログアウト時に未送信件数を示し、「同期してログアウト」または「未送信を破棄」を選べる設計にする。

UTCは区間の照合用、端末内の経過計測は単調時計を使う。時計変更を検知したらsessionを切る。未来5分超・過去7日超の観測は自動実績から除外する案。サーバー時刻との差分は診断に使い、過去イベントの時刻をこっそり書き換えない。

---

<a id="s17"></a>

## 17. HTTP APIとレスポンス設計

APIは`/api/v1`をprefixとする。以下のパスと細部は設計案であり、ユーザーが各名称を指定したものではない。

### 17.1 認証・端末

| Method | Path | 用途 |
|---|---|---|
| GET | `/auth/{provider}/start` | Google/GitHubの認証開始 |
| GET | `/auth/{provider}/callback` | Backendでprovider応答を処理 |
| POST | `/auth/logout` | Web sessionの終了 |
| POST | `/device-links` | 端末連携の開始 |
| POST | `/device-links/{id}/approve` | ログイン済みWebから連携を承認 |
| POST | `/device-links/{id}/exchange` | 一回限りの連携情報をtokenへ交換 |
| GET | `/me` | 自分の基本プロフィール |
| GET | `/me/identities` | 自分のログイン方法一覧 |
| GET | `/me/devices` | 自分の端末一覧 |
| DELETE | `/me/devices/{device_id}` | 端末tokenの失効 |
| POST | `/me/identities/{provider}/link` | 別のログイン手段の連携開始 |
| DELETE | `/me/identities/{provider}` | ログイン手段の解除 |

`provider`の許可リストは`google` / `github`。Xは実装・設定が完了するまで受理しない。

### 17.2 記事・記録・自分の画面

| Method | Path | 用途 |
|---|---|---|
| POST | `/articles/resolve` | URLまたはwiki/page IDから記事解決 |
| GET | `/articles/{article_id}` | 内部IDで逆引き |
| GET | `/wikis/{wiki}/pages/{page_id}` | wiki/page IDで逆引き |
| POST | `/articles/batch-get` | 複数の記事メタデータ |
| POST | `/reading-events/batch` | 共通イベント |
| GET | `/me/activities` | 読書活動の時系列 |
| GET | `/me/articles` | 記事ごとの状態 |
| GET | `/me/articles/{article_id}` | 自分の状態・時間・根拠 |
| PUT | `/me/articles/{article_id}/state` | 手動状態を設定 |
| DELETE | `/me/articles/{article_id}/state` | 手動設定だけを消して自動へ戻す |
| DELETE | `/me/articles/{article_id}/history` | その記事の個人履歴を削除 |
| GET | `/me/stats` | 集計値 |
| GET | `/me/achievements` | 固定ルール称号 |
| GET / PATCH | `/me/privacy` | 公開範囲と収集設定 |
| DELETE | `/me/history` | 全読書履歴の削除 |
| POST | `/me/export` | 個人記録のJSON export生成 |
| DELETE | `/me` | アカウント削除 |

記事メタデータAPIに他人の`user_id`を渡して読書状態が分かる設計にしない。個人APIは常に認証ユーザーを基準にする。

### 17.3 記事逆引きの応答例

```json
{
  "article_id": "40000000-0000-4000-8000-000000000001",
  "wiki": "jawiki",
  "page_id": 12345,
  "language": "ja",
  "title": "架空の記事タイトル",
  "canonical_url": "https://ja.wikipedia.org/wiki/%E6%9E%B6%E7%A9%BA%E3%81%AE%E8%A8%98%E4%BA%8B%E3%82%BF%E3%82%A4%E3%83%88%E3%83%AB",
  "namespace": 0,
  "trackable": true,
  "untrackable_reason": null,
  "metadata_status": "fresh",
  "resolved_at": "2026-10-04T12:00:00Z"
}
```

架空の例であり、そのIDとタイトルの対応が実在すると示すものではない。消えた記事は`availability="missing"`等で表現できるようにする。`latest_revision_id`等は必要な場合に追加する。

### 17.4 統計API

`GET /me/stats`は次の意味のフィールドを返す案。

```text
recorded_article_count
qualified_article_count
state_counts: viewed / partial / completed
completed_inferred_count
completed_self_reported_count
activity_count
active_ms
estimated_unique_read_chars
by_wiki
pending_recalculation
as_of
timezone
```

`from` / `to`、wiki等のフィルタは許可するが、フィルタの意味を固定する。responseでは`library`（現在の蔵書・状態）と`activity`（対象期間の活動）を分ける案とする。`library`の状態別件数は`as_of`時点の値、期間内活動数と記事種類数はqualified sessionの`session_started_at`を基準とする。時間は期間との交差区間、推定文字数はその期間の増分である。期間内の「当時の状態」を復元する機能はMVPには含めず、過去期間の画面でも現在の到達状態と明記する。ユーザーの統計表示timezoneは初期`Asia/Tokyo`を仮置きし、設定で変更可能にする案。保存時刻はUTC。日跨ぎの区間は表示timezoneの日付境界で分割する。

### 17.5 一覧とエラー

一覧はcursor方式、初期50件・最大100件。安定した並びとして`(started_at, id)`等を使う。大量offsetだけに依存しない。

```json
{
  "error": {
    "code": "article_not_found",
    "message": "記事を取得できませんでした。",
    "retryable": false,
    "request_id": "example-request-id"
  }
}
```

UIはcodeで判定し、サーバーの内部例外文字列をそのまま表示しない。API障害、記事消失、対象外ページ、認証切れを区別する。

### 17.6 後続ソーシャルAPI

`POST /posts`、`GET /feed`、`DELETE /posts/{id}`、`POST /posts/{id}/reports`等はMVP-Bで追加する。読了判定から自動で呼び出さない。投稿にはidempotency key、plain-textの長さ制限、所有者検査、レート制限を設ける。

---

<a id="s18"></a>

## 18. 認証・ユーザーID・アカウント連携

### 18.1 内部ユーザーID [確定]

```text
User.id = wikimf独自のUUID

AuthIdentity
  (provider, provider_subject) → User.id
```

メールアドレス、Googleの表示名、GitHubのlogin名を主キーにしない。Googleでは`sub`がアカウント識別に使われ、メールは識別子として使わないよう公式に案内されている。[^W10]

GitHubはOAuthで得たtokenを使い、認証されたユーザーのAPI応答からIDを取得する。ユーザー入力のGitHub名を信用してログインさせない。GitHubのweb flowは、GoogleのOIDC ID token検証と同一の手順ではない。[^W11][^W12]

### 18.2 最小権限

Googleはログインに必要なOIDC scope、GitHubも本人識別に必要な範囲だけを要求する。リポジトリ、Drive、メール本文、投稿権限等は不要。メールの取得を必須にしなくても動くUserモデルにする。

provider tokenをwikimf API用tokenとして流用しない。ログイン後に必要がないprovider tokenは長期保存しない。OAuth client secretはBackendだけに置く。

### 18.3 Webを認証の入口にする [設計案]

MVPではGoogle/GitHubへのログインをWeb側へ集約し、Androidと拡張は、そのアカウントへ端末連携する方式を推奨する。

```text
Android / Chrome拡張
   → 外部ブラウザでwikimf連携画面
   → GoogleまたはGitHubでログイン
   → この端末を連携することを確認
   → 端末が専用tokenを取得
```

Wikipedia WebView内でOAuth画面を開かない。GoogleのNative Android専用ログインを後から導入する場合はCredential Manager等の公式方式を検討するが、初期の「Webサービスへブラウザでログインして端末を連携する」流れとは分ける。[^W10]

Webのprovider認証は既存の成熟したOAuth/OIDC実装を使い、state、Googleのnonce、redirect URI、token検証等を正しく扱う。GitHubの現在のweb flowにはPKCEの指定も記載されている。採用するライブラリでproviderごとに対応を確認する。[^W10][^W11]

### 18.4 端末連携の具体案

1. Native/workerが連携要求を作る。device種別・表示名とともに、連携要求を識別するIDと高エントロピーの端末秘密値を受け取る。
2. ユーザー確認用のコードと、wikimf自身の検証用Webページを表示する。端末秘密値はURLへ入れない。
3. Web側でログインし、表示コード・端末名・要求scopeを確認して承認する。アクセスしただけで自動承認しない。
4. 元のNative/workerが端末秘密値を提示し、承認済みの連携を一回限りでtokenへ交換する。
5. 元のクライアントで自分の表示名を確認し、計測の同意を得て記録開始する。

連携要求は5分で失効、承認後も一回限り。照合試行回数とpoll頻度を制限する。ユーザー確認用の短いコード単独ではtokenを取得できないようにする。

これはwikimf内の端末連携設計であり、providerのDevice Authorization Flowと同一だとは説明しない。認証プロトコル自体の独自発明を避け、実装時に利用ライブラリと脅威モデルを確認する。

token交換の応答を失った場合、初期実装では古い連携を再利用せず新しくやり直せるようにする。未使用端末tokenは短い猶予後に整理する。

Androidへ戻るためにApp Linksを使う場合は、**自分で管理するwikimfのドメイン**を検証する。Wikipediaのドメインを自分のApp Linksとして検証できる前提にはしない。App LinksはWebサイトとアプリの関連付けを検証する仕組みである。[^W13]

App Linksが未設定の開発段階でも、アプリへ戻って「連携を確認」を押すことで完了できるようにし、初期開発をドメイン設定に完全依存させない。

### 18.5 tokenとWeb session

端末tokenは十分なランダム性を持つopaque tokenの案とし、Backendにはhashを保存する。期限・失効・最終利用・scopeを保持する。期限は90日を仮置きし、失効前後の再連携UIを用意する。

最低限のscope例：

```text
reading:write
reading:read
profile:read
```

記事履歴の大量削除、公開設定、認証手段の追加等はWeb sessionと必要に応じた再認証で実施する。tokenのscopeが不足する操作をClient側の非表示だけで守らない。

WebはHttpOnly / Secure等を設定したcookie sessionを使う案。変更系操作にはCSRF対策を行う。CORSは認証の代替ではない。ログ・例外・analyticsへtokenを出さない。

### 18.6 GoogleとGitHubを同じユーザーにする

**メールアドレスが同じでも自動結合しない。**

先にGoogleで登録したユーザーがGitHubを追加する場合は、ログイン済みの「ログイン方法を追加」からGitHubで再認証し、同じUser.idへAuthIdentityを追加する。

未ログインから未連携providerで入った場合に、別Userが作成され得ることを明示する。既存の別UserとのmergeはMVPでは自動実施しない。別ユーザーに連携済みのidentityを奪えないようにする。

最後の一つのログイン手段は解除できない。端末tokenだけを残してアカウントへ入れなくする操作を防ぐ。

### 18.7 X [後続]

低優先度のログインproviderとして追加余地を残す。料金、審査、利用条件、必要なAPI契約は本書では未調査であり、無料・無条件で提供できるとは決めない。Google/GitHubの完成をXの調査待ちにしない。

---

<a id="s19"></a>

## 19. DBモデル・トランザクション・可搬性

### 19.1 基本方針 [確定]

PostgreSQLを本番の基本とする。SQLAlchemyで永続化を扱い、DB URLは設定から注入する。Alembicでschemaを移行する案。

「DB変更余地」は、**DB依存処理を限られた場所へ閉じ込め、別DBでテストできること**を意味する。接続文字列だけ変えれば必ず全機能が動くという約束ではない。

### 19.2 テーブル案

| テーブル | 主な列・制約 |
|---|---|
| `users` | UUID、表示名、timezone、recording_epoch、作成・削除日時 |
| `auth_identities` | user_id、provider、provider_subject、UNIQUE(provider,subject) |
| `web_sessions` | session hash、user_id、有効期限、最終利用 |
| `devices` | UUID、user_id、source、token_hash、scope、期限、失効日時 |
| `device_link_requests` | grant ID、秘密値hash、確認コードhash、承認者、期限、交換状態 |
| `user_privacy_settings` | user_id、プロフィール・統計公開、収集同意version等 |
| `articles` | UUID、wiki、page_id、UNIQUE(wiki,page_id)、title、URL、namespace、解決状態 |
| `article_aliases` | aliasのwiki/title/page ID等、canonical article、確認日時 |
| `reading_sessions` | user_id + session_id、device/article、Document定義、開始・終了、snapshot、判定version |
| `reading_events` | event ID、session、seq、区間、payload digest、受理日時、検証結果 |
| `reading_intervals` | 有効なactive区間、user/article/session、受理順、計上情報 |
| `article_reading_states` | UNIQUE(user_id,article_id)、自動/手動状態、最大推定文字数、最終閲覧 |
| `reading_stat_increments` | 文字数最大値の増分と根拠session・時刻等 |
| `history_deletion_markers` | 対象記事/セッションと削除基準。古いキューの復活を防ぐ最小情報 |
| `posts` | 後続。user/article、plain-text本文、公開日時、削除日時 |
| `post_reports` | 後続。通報と処理状態 |

最初から全てを高機能な抽象テーブルにする必要はない。`article_aliases`等は利用箇所ができた時点で追加してもよい。Auth、Article、session、event、interval、stateは責務を分ける。

### 19.3 session・eventのキー

クライアント生成UUIDを受け付けるため、すべてのsession取得・更新にuser_idを含める。別ユーザーのsession IDを本文に指定して更新できる設計を避ける。

```text
ReadingSession: UNIQUE(user_id, session_id)
ReadingEvent: UNIQUE(user_id, event_id)
ReadingEvent: UNIQUE(user_id, device_id, session_id, seq)
ArticleReadingState: UNIQUE(user_id, article_id)
```

deviceとuser、sessionとarticleの不変条件をアプリだけでなく可能な範囲でDB制約に反映する。

### 19.4 トランザクション

初期案は**同一ユーザーの時間集計更新を直列化**する。PostgreSQLでは対象User等の行をロックし、イベント受理、重複判定、interval割当、session更新、state更新を一つの短いtransactionで行う。

別ユーザーの処理までグローバルロックしない。ロック中にWikipedia、Google、GitHubへネットワーク通信を行わない。

競合するINSERTは一意制約を正として処理する。事前SELECTだけで「重複はない」と判断しない。transactionが失敗したイベントをacceptedとして返さない。

### 19.5 DB差分を閉じ込める

共通型を中心に使い、PostgreSQL固有のJSONB/ARRAY/ENUM、全文検索、独自関数、advisory lock等をドメイン層へ散らさない。SQLAlchemyには汎用型とdialect固有型の区別がある。[^W14]

Documentのchunk定義やsnapshotには汎用JSONを使う案。ただし主要な検索条件、一意制約、時間計上の基準を巨大JSONの中だけに置かない。

UTCの保存・復元、UUID、Boolean、日時、JSON、upsert、一意制約違反、transaction isolationの差はDB層で扱う。

Repositoryを作る場合も、記事解決やイベント保存等の境界に必要なものだけにし、すべてのORM操作に万能Factoryを被せない。

### 19.6 SQLiteの位置づけ

SQLiteは任意の開発・小さな単体テスト用に使えるようにする案だが、PostgreSQLの代替検証にはしない。

SQLiteモードでは単一writer/単一プロセス等の運用制約を明示する。`SELECT FOR UPDATE`と同等の挙動を期待しない。本番の並行処理・migration・削除・時刻集計はPostgreSQLで統合テストする。

別DBの本番対応は、そのDBでテストを通したとき初めて「対応」と呼ぶ。

---

<a id="s20"></a>

## 20. プライバシー・停止・削除・保存期間

### 20.1 標準の公開範囲 [確定]

| 情報 | 初期状態 |
|---|---|
| 読んだ記事一覧 | 非公開 |
| 閲覧日時・読書経路 | 非公開 |
| 読書状態・時間 | 非公開 |
| 推定文字数・統計 | 非公開 |
| 称号・プロフィール | 非公開。本人が選んだ範囲だけ公開可能 |
| 記事投稿 | 本人が投稿操作をしたものだけ公開 |
| Neighbours用の利用 | 初期は無効。将来別途同意を設計 |

非公開でも運営サーバーには同期される。**非公開は「端末から一切出ない」の意味ではない。** 端末内だけの最近の記事、サーバー同期される読書履歴、他人へ公開する情報の3層を説明する。

### 20.2 収集しないもの

キー入力内容、フォーム入力、Cookie、パスワード、Wikipedia以外の閲覧履歴、外部referrer、Wikipedia本文全文、途中入力の検索語、他アプリの利用内容は収集しない。

アクティブ判定のためのkeydown等は「操作が発生した」という事実だけ使う。本文hashも匿名化の保証ではなく、公開本文と対応づけ可能な情報として扱う。

### 20.3 停止の意味

| 操作 | 効果 |
|---|---|
| 記録を一時停止 | 新しい読書観測と端末内の最近の記事への追加を止める |
| 同期を一時停止 | 記録が残る場合があるため、別操作として出す場合は明記 |
| この記事を削除 | サーバー履歴・状態・統計への寄与を削除 |
| 履歴を全消去 | 全履歴と派生集計を削除し、記録世代を更新 |
| 端末解除 | その端末tokenを失効 |
| ログアウト | アカウント表示とtokenを外し、別アカウントへキューを流用しない |

初期UIは混乱を避けて「記録を一時停止」を中心にする。これは初期仕様では**この端末だけ**の停止とし、他端末も止める操作とは区別する。全端末の受入を止める場合はDashboard側の設定や端末失効を用い、サーバー側でも拒否する。停止前に既に作成されたOutboxは本人に表示し、送信または破棄を選べるようにする。停止した直後に何が送られるのかを隠さない。

この停止は、Wikipediaやブラウザ自身が行うログ・キャッシュ・履歴まで止める機能ではない。

### 20.4 削除した履歴の復活防止

単にprojectionの行だけ消すと、残ったイベントの再集計や端末の再送で履歴が復活する。削除は次のデータを同時に対象とする。

```text
対象のイベント・session・interval
手動状態・記事集計・文字数増分
対象の公開投稿（選択した削除範囲に応じる）
端末内cacheと未送信キューへの削除通知
再送拒否のための最小marker
```

全履歴削除ではUserの`recording_epoch`を増やし、古いepochのイベントを拒否する。端末は新epochを確認して古いOutboxを破棄し、新しいsessionから記録する。

記事単位の削除では、削除以前のsessionを識別するmarkerと削除基準時刻を持つ。すべてのイベントに`session_started_at`を含め、削除前に始まった未着sessionも再送で復活させない。削除前sessionで読み続けていた端末は、同期で削除を知った時点から新sessionにする。

時計の異常・遅延境界では安全側に拒否し、`history_deleted`等で理由を返す。これは悪意ある本人が新規イベントを偽造することを防ぐ証明ではなく、**通常のオフライン再送からの復活を防ぐ仕組み**である。

記事の公開メタデータcacheは残してよいが、そのユーザーが読んだという関係は残さない。必要な拒否markerはキューの有効期間等を超えたら削除する。削除操作だけを理由に本文や詳細な履歴を永久保存しない。

### 20.5 保存期間 [未決、初期案]

| データ | 仮置き |
|---|---|
| 端末の最近の記事 | 各20件。明示削除・保存停止可能 |
| 未送信Outbox | 最大7日 / 10MiB |
| 読書イベントの詳細payload | クローズド検証中は保持。正式運用の案は90日 |
| 読書履歴・記事別状態 | 本人が削除するまで |
| 再計算に必要なinterval・根拠 | 履歴を保持する限り保持する案 |
| 認証grant | 5分で失効し、短期間で掃除 |
| アクセス・障害ログ | 個人記事情報を含めず、期間は運用時に決定 |
| Backup | 保存期間と削除反映の期限を公開前に決定 |

詳細eventを90日で削除するなら、削除後も状態・時間・文字数の訂正を行える**圧縮後の根拠データ**を残す必要がある。全部消して「いつでも完全再集計できる」とは書かない。

MVP-Aのクローズド版は単純な保存で始めてもよいが、公開前に保持期間・削除job・backupからの復活防止を確定する。exportには本人の履歴を含め、token等の秘密情報は含めない。

### 20.6 本人の興味から人物像を断定しない

Neighboursやジャンル統計を追加しても、読んだ記事から本人の信仰、病歴、政治的立場、性的属性等を確定・公開する設計にしない。カテゴリ別の一括除外も、分類漏れがあるため完全な機密保護だとは説明しない。

共有の説明に、本人が選んでいない具体的な読書履歴を漏らさない。推薦に使うことと相手へ履歴を見せることは別の権限にする。

---

<a id="s21"></a>

## 21. Web Dashboardと最小ソーシャル

### 21.1 Dashboardの役割 [確定]

Androidは読むための小さな入口、Webは記録を振り返り管理する場所とする。Androidから開くため、狭い画面でも使えるようにする。

| 画面 | 最小内容 |
|---|---|
| Overview | 記事数、3状態、時間、推定文字数、最近の活動、基本称号 |
| Library | 記事一覧、言語・状態フィルタ、手動状態変更 |
| Activity | session単位の時系列、再読、計測元、自動/手動の根拠 |
| Article record | 対象記事の自分の記録、本文へのリンク、削除 |
| Account | 表示名、Google/GitHub連携、端末一覧 |
| Privacy | 公開範囲、収集同意、履歴削除、export |
| Profile | 公開を選んだ情報だけの公開ページ。初期は非公開 |

元のWikipediaへ飛ぶ通常リンクには、Webだけでその後を計測できるという説明を付けない。PCでは拡張、AndroidではReader内での利用が計測経路になる。

### 21.2 公開プロフィール

初期はOFF。公開をONにした場合も、総時間を公開したことを理由に記事一覧まで公開しない。

公開プロフィール用のresponse schemaを個人用と別にし、非公開項目をフロント側で隠すだけにしない。公開キャッシュに個人APIの応答を流用しない。URLを知っているだけで非公開履歴を読めないようにする。

### 21.3 記事共有 [MVP-B]

共有する内容は、記事参照と本人の一言コメントを中心にする。Wikipedia本文の長い転載やAI生成要約はMVPでは扱わない。

```text
記事タイトル / 言語
Wikipediaへのリンク
本人のコメント
投稿者 / 投稿日時
```

元の記事を読了していなくても共有は可能とする案。共有した事実だけで読了にしない。投稿の削除と読書履歴の削除は別操作として説明する。

初期フィードは時系列。フォロー、複雑なおすすめ、返信、DMは持たない。publicにする場合は通報、レート制限、悪用時の停止・削除等を実装し、開発機能だけ完成して運営導線がない状態で公開しない。

### 21.4 UIに出す説明の例

- 「読了は表示状況と時間からの推定です。自分で変更できます。」
- 「推定読書文字数は、再読を重複加算しない値です。」
- 「最近見た記事はこの端末の履歴です。読書実績とは別に管理されます。」
- 「この記事は記録対象外です。閲覧は引き続き利用できます。」
- 「記録は非公開です。記事を投稿したときだけ、その投稿が公開されます。」

---

<a id="s22"></a>

## 22. 既存Wikipedia_Raceの再利用方針

### 22.1 この章の根拠

この章は添付`wikipedia-sns-mvp-design.md`に記載された調査結果を引き継ぐ。添付ではmainの`6ee9dcd70694035ed2ec9c829d10e404b83b20df`を静的調査しているが、本書作成時点のmainを再確認していない。現在も同じコード・不具合であると断定しない。[^S1]

### 22.2 再利用する境界

| 既存の部品 | wikimfでの用途 |
|---|---|
| MediaWikiへのrequests、retry、continue処理 | `MediaWikiClient`を作る際の参考・移植素材 |
| URLからタイトルを取り出す処理 | 安全なURL parserの素材。例外処理と正規化を追加 |
| SQLAlchemyの基本構造 | 永続化の設計経験として利用。schemaは今回に合わせて作る |
| リンク存在確認 | 後続Wiki Raceのルール検証 |
| Puzzle / Submission | ゲーム側のdomainとして隔離 |
| ページングのテストfixture | MediaWikiClientの回帰テストへ移植 |

FlaskのBlueprintをそのままFastAPIの設計へ持ち込まない。既存の匿名ランキングを認証済みの読書実績に流用しない。SNSの読書追跡が既存Raceに実装済みとは扱わない。[^S1]

### 22.3 移植前の再確認候補

添付に挙がっていた起動時import、静的配信path、DateTimeへの文字列保存、ADMIN_TOKEN既定値、Wikipedia URL decode、APIエラー区別、Raceの始点終点検証などを、移植時に現在のコードで再検証する。未実行の指摘を修正済みとはしない。[^S1]

### 22.4 ゲームと読書を混ぜない

Raceのリンク到達、通過記事、制限時間と、普通の読書のcoverage・時間は別domainである。

```text
GameSession / RouteStep / Submission
            ≠
ReadingSession / ReadingEvent / ArticleReadingState
```

ゲーム中に高速で開いた記事を、それだけで読了記事数へ入れない。ゲームの経路を共有しても、非公開の通常読書履歴が自動公開される設計にしない。

初期のゲーム接続は、通常の読書の記録が完成した後に行う。グラフDBを入れることを必須にせず、既存のリンク確認・API・cacheから始める。

---

<a id="s23"></a>

## 23. コード構成・設定・外部サービス運用

### 23.1 リポジトリ構成案

```text
wikimf/
├── apps/
│   ├── android/
│   │   ├── reader/
│   │   ├── search/
│   │   ├── account/
│   │   ├── tracking/
│   │   └── data/
│   ├── extension/
│   │   ├── content/
│   │   ├── worker/
│   │   ├── popup/
│   │   └── storage/
│   └── web/
├── packages/
│   ├── wiki-tracker/
│   │   ├── article-adapter/
│   │   ├── active-time/
│   │   ├── coverage/
│   │   └── protocol/
│   └── contracts/
├── backend/
│   ├── api/
│   ├── auth/
│   ├── articles/
│   ├── reading/
│   ├── achievements/
│   ├── social/
│   ├── infrastructure/
│   └── migrations/
├── tests/
│   ├── contracts/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
├── docs/
└── games/
    └── wiki-race/     # 後続・既存資産を隔離
```

実際のPython package名、Android moduleの数などは必要最小限にする。ディレクトリを分けたことを理由に、すべて別サービス・別ビルドにしない。

### 23.2 Backendの層

```text
FastAPI route
    認証済みコンテキスト / Pydantic request
        ↓
Application service
    記事解決、イベント受理、状態修正、削除
        ↓
Domain rules
    状態判定、区間統合、実績条件
        ↓
SQLAlchemy repositories / Wikimedia adapter
```

読書判定をHTTP handlerに直書きしない。単体テスト可能な純粋関数に寄せる。モデルとI/Oは薄い境界で接続する。

同期SQLAlchemyを使うなら同期のpath/service構成、asyncを使うならAsyncSessionに統一する。`async def`の中に既存の同期requestsをそのまま置かない。初期案はAPI構成に合わせて一方を選び、混在を避ける。具体的な同期/非同期の選択は未決。

### 23.3 主な設定

```text
DATABASE_URL
PUBLIC_BASE_URL
API_BASE_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET
DEVICE_TOKEN_HASH_SECRET
WIKIMEDIA_USER_AGENT
SUPPORTED_WIKIS
READING_POLICY_VERSION
OUTBOX_MAX_AGE_DAYS
OUTBOX_MAX_BYTES
```

秘密値はリポジトリへcommitしない。`.env.example`は空欄または明確なサンプルのみ。安全でない管理tokenの既定値を設けない。

記事・source・scope等の許可リストはサーバーでも定義する。クライアントの設定変更だけで第三のwikiや別APIホストを許可しない。

### 23.4 Wikimedia API

呼び出し元を識別できるUser-Agentと連絡先を設定し、429等の抑制指示、Retry-After、利用規約に従う。WikimediaはAPIの利用上限・仕様を変更し得るため、固定の無制限利用を前提にしない。[^W15]

retry対象は一時的な通信障害・429・一部5xx等に限定し、非再試行エラーを無限再試行しない。timeout、総retry時間、ページングの最大回数を設定する。

記事メタデータはcacheし、10秒ごとの観測のたびにWikipedia APIへ問い合わせない。検索は入力debounceと短命cacheを使う。

### 23.5 ライセンス・表示

Reader内ではWikipediaの出典・履歴・ライセンス表示を隠さない。検索結果の本文抜粋等を再表示する場合も、元記事・出典への導線を用意する。

Wikimediaの利用規約は、テキストの再利用時の帰属表示と、非テキストメディアについて各ライセンスへの対応を求めている。画像を取得できたことを理由に、無条件で転載可能とみなさない。[^W16]

検索結果の画像は初期必須にせず、転載・cache・加工を追加する段階で、その範囲に合う表示とライセンス確認を行う。非公式サービスであることを明示し、公式ロゴ・商標の使用可否を勝手に確定しない。

### 23.6 インフラ・配布 [未決]

本番ホスティング、ドメイン、APK配布かPlay公開か、Chrome Web Store公開時期は未決。特定クラウドの料金や無料枠を前提にしない。

開発はDocker Compose等でAPI・PostgreSQLを再現できる構成を推奨。公開時はHTTPS、migration、backup、復元手順、秘密管理を用意する。

Androidの署名鍵・application IDは配布前に確定する。署名鍵を失っても同じアプリとして自由に更新できる、などの前提を置かない。公開先の最新要件は配布時に別途確認する。

---

<a id="s24"></a>

## 24. テスト計画と受入条件

### 24.1 テスト層

| 層 | 検証 |
|---|---|
| Python unit | 状態判定、文字数上限、区間union、手動override、称号 |
| Python integration | PostgreSQLで認証、API、重複、競合、削除、migration |
| TypeScript unit | URL処理、chunk化、timer、snapshot、schema |
| DOM fixture | 日本語・英語、短文・長文、折りたたみ、脚注等の除外 |
| Android unit / UI | Search state、履歴、戻る、Account、Hostの停止条件 |
| Android実機 | WebView機能検出、bridge、IME、画面ロック、復帰 |
| Chrome実環境 | 複数タブ、別window、worker停止、BFCache、再送 |
| E2E | PCとAndroid→同じUser→Dashboardまでの縦断 |
| Security | 別ユーザーID、偽のURL、token、scope、削除後再送 |

単体テストの件数だけで完成としない。実際のWikipedia DOMと端末での手動確認を組み合わせる。

### 24.2 機能別の必須ケース

#### Reader / Navigation

| ID | ケース | 期待結果 |
|---|---|---|
| N01 | 日本語記事を開く | 本家表示、正しいwikiへ記録 |
| N02 | 英語記事を開く | 同上 |
| N03 | 戻る・進む | WebView履歴とボタン状態が一致 |
| N04 | 履歴がない | 前後ボタン無効。上部戻るでアプリ終了しない |
| N05 | 同一記事のアンカー移動 | 記事数・sessionを増やさない |
| N06 | 外部HTTPSリンク | 外部ブラウザ。Reader計測は停止 |
| N07 | 偽サブドメイン・userinfo付きURL | Reader/bridgeの許可をすり抜けない |
| N08 | `javascript:` / `file:` / 任意Intent | 外部起動口として通さない |
| N09 | 新規windowリンク | URL検査後、規定の一つのReaderまたは外部へ |
| N10 | Reader→Account→Reader | 位置・履歴を維持。Account時間は加算しない |
| N11 | 回転・文字サイズ変更 | 不要なreload・二重sessionを作らない |
| N12 | プロセス終了・復帰 | 新session、停止中の時間を加算しない |
| N13 | 記事画像が別配信host | 必要な表示を壊さずbridgeは公開しない |
| N14 | SSLエラー・レンダラ停止 | 安全に停止し、再試行できる |

#### Search

| ID | ケース | 期待結果 |
|---|---|---|
| S01 | ゼロ入力 | 2種類のローカル履歴 |
| S02 | 1文字入力 | debounce後に候補 |
| S03 | 日本語IME変換中 | 不要な連続問い合わせを抑制 |
| S04 | Enter / IME検索 | 本文を含む検索へ |
| S05 | 候補をタップ | 正しい記事をReaderで開く |
| S06 | 候補が出ただけ | 最近検索した記事へ登録しない |
| S07 | 検索結果から開く | 最近検索した記事へ登録 |
| S08 | 日本語→英語、応答逆転 | 古い言語の結果で上書きしない |
| S09 | 0件 | エラーと区別 |
| S10 | オフライン・429 | 履歴選択・再試行・抑制が働く |
| S11 | 説明文なし・長いタイトル | レイアウトが壊れない |
| S12 | excerptにHTML | 実行せず安全なテキストとして表示 |
| S13 | 端末履歴を削除 | 再表示されず、他アカウントへ混入しない |
| S14 | 既定検索言語変更 | 現在の記事を勝手に移動しない |

#### Tracking / 状態

| ID | ケース | 期待結果 |
|---|---|---|
| R01 | 5秒で離脱 | 自動閲覧記事数には入らない |
| R02 | 10秒active | viewed境界が一致 |
| R03 | 30秒＋必要なcover | partial境界が一致 |
| R04 | 80%cover＋必要時間 | completed境界が一致 |
| R05 | Endキーで末尾へ | 中間chunkをcoverしない |
| R06 | 放置・sleep・ロック | 条件外の時間を加算しない |
| R07 | Native検索表示 | WebViewがvisibleでも計測停止 |
| R08 | 60秒以上静かに読む | 初期の過小評価を再現し、説明と再開操作あり |
| R09 | 長い段落・折りたたみ | viewportで判定可能。未展開本文を勝手にcoverしない |
| R10 | infobox・脚注・ナビ | 初期の文字数対象から除外 |
| R11 | 抽出失敗・本文0 | 読了にせずtime_only |
| R12 | 本文変更 | Document/sessionを分割 |
| R13 | 旧版・差分・検索 | 自動実績対象外 |
| R14 | 再読 | 活動・時間は増え、記事種類数は増えない |
| R15 | 日英の同主題 | 別記事として扱う |
| R16 | 手動読了 | 状態だけ変わり、時間・文字数は捏造しない |
| R17 | 手動設定解除 | 自動状態へ戻る |
| R18 | 別sessionで半分ずつ読む | MVPではcoverを合成しない |

#### 同期 / DB / プライバシー

| ID | ケース | 期待結果 |
|---|---|---|
| D01 | 同じイベント10回 | 1回分だけ計上 |
| D02 | 同IDで違う内容 | conflictとして拒否 |
| D03 | seq逆転・open/closed欠落 | 復元でき、未着時間を勝手に補完しない |
| D04 | ACK紛失 | 同ID再送でduplicate |
| D05 | worker停止・アプリkill | 保存済みOutboxは残る |
| D06 | PCとAndroidで時間重複 | unionで二重加算しない |
| D07 | 同じユーザーへ並列送信 | 競合下でも統計が一致 |
| D08 | token失効・ユーザー切替 | 別ユーザーに送らない |
| D09 | article_idとwiki/pageid不一致 | 拒否 |
| D10 | 別ユーザーのsession/article状態更新 | 拒否 |
| D11 | 記事削除後に旧イベント再送 | 履歴が復活しない |
| D12 | 全履歴削除後に旧epoch送信 | 拒否し、端末の古いキューを処理 |
| D13 | 非公開プロフィールのURLアクセス | 個人情報が出ない |
| D14 | 手動状態のみ・未投稿 | 公開フィードへ出ない |
| D15 | 同じメールのGoogle/GitHub | 未承認の自動結合をしない |
| D16 | identityを明示的に追加 | 同じUserに両方でログインできる |
| D17 | 最後のidentity解除 | 拒否 |
| D18 | 記事逆引きAPI | 正規ID・redirect・missing・staleを区別 |
| D19 | migration前後 | データ・制約・集計が保たれる |
| D20 | timezone日跨ぎ | 総時間と日別時間が一致 |
| D21 | tokenや検索語のlog検査 | 秘密情報・不要な履歴が出ない |
| D22 | Outbox上限 | 無言上書きせず停止・通知 |
| D23 | 未来・過去の異常時刻 | 実績へ無条件に計上しない |
| D24 | cacheされた個人応答 | 別ユーザーへ配信しない |

### 24.3 本文fixture

短い記事、長い記事、長段落、箇条書き中心、表中心、数学記法を含む記事、モバイル折りたたみ、日英双方を用意する。実在記事のHTMLをfixtureとして保存する場合は出典・revision・ライセンス情報も記録する。

外部APIを呼ばない固定fixtureのテストと、実サイトへの少数の疎通テストを分ける。CIのすべてのテストがWikipedia APIの可用性に依存する設計にしない。

### 24.4 リリース判定

上記の重大なデータ漏洩、二重計上、削除復活、戻る操作や検索の基本破綻を残したまま「MVP完成」としない。未対応のOS/WebView、抽出不能な記事形式、既知の過小評価はrelease notesに明示する。

---

<a id="s25"></a>

## 25. 非機能要件・監視・障害時の体験

数値は性能保証ではなく、最初の検証用の目標値・観測項目である。

| 項目 | 初期方針 |
|---|---|
| Readerの優先度 | 計測より記事閲覧を優先。tracker障害で読めなくしない |
| UI負荷 | scrollごとの全DOM走査を避ける。重い処理は分割・間引き |
| 通信頻度 | 1秒tickをそのままHTTP送信にしない。保存・送信をbatch化 |
| API応答 | cache hitの個人画面API等はp95 500ms未満を目標に測定 |
| 検索待ち | 300msのdebounceと外部APIの待ち時間を区別して表示 |
| Dashboard | 初期は数十件単位の一覧。全履歴を一度に送らない |
| 電池 | 常時foreground serviceやwakelockを計測のためだけに要求しない |
| 可用性 | Backend停止時もReaderは閲覧でき、保存可能な記録をOutboxへ |
| 整合性 | accepted応答の前にtransactionをcommit |
| 復旧 | migration失敗、backup復元、token漏洩時の失効手順を準備 |

### 障害時の表示

| 障害 | ユーザーに示す内容 |
|---|---|
| Wikipedia検索API失敗 | 検索できない。ローカル履歴と再試行は使用可能 |
| 記事表示失敗 | Readerの再読み込み・ブラウザで開く |
| Backend失敗 | 未送信件数を示し、読書は継続可能 |
| 本文抽出失敗 | 時間のみ記録。文字数・読了の自動判定なし |
| 安全なbridge非対応 | Readerのみ利用可能。計測不可を明示 |
| 認証失効 | 再連携が必要。違うアカウントへ送信しない |
| Outbox満杯 | 計測/同期の状態と対処を示す |

### 運用で見たい指標

API error rate、受付/重複/拒否件数、Outboxの滞留件数・最古日時、DOM抽出失敗率、token失効率、記事Resolverのcache hit率、DB容量、ユーザー単位の再集計時間等。

監視のために記事本文、検索語、個人の全URLを第三者のerror trackingへ送らない。request_idと匿名化を過信しない技術的なコード、client_version、extractor_version等で原因を追えるようにする。

### 同じ端末での再現確認

Android端末のWebView実装、文字サイズ、画面回転、バッテリー制限、ネットワーク切替の影響を記録する。PCでも複数window、zoom、スキン差、拡張workerの停止を試す。ブラウザ内のmockだけで十分と判断しない。

---

<a id="s26"></a>

## 26. 段階的な実装計画

### 26.1 Androidから作る順序 [設計案]

| 工程 | 実装 | 完了条件 |
|---|---|---|
| 0 | リポジトリ・契約・DB基盤 | FastAPI、migration、PostgreSQL、CIが起動する |
| 1 | Androidの薄いReader | 日英の本家表示、前後移動、外部リンク、タブが動く |
| 2 | Native検索 | autocomplete、全文検索、日英切替、2種類の最近の記事 |
| 3 | Web認証・端末連携 | Google/GitHubで同じ内部ユーザーへ連携できる |
| 4 | Article Resolver・逆引き | URL / wiki+page ID / 内部UUIDで同じArticleへ到達 |
| 5 | 時間だけの縦断 | Android観測→Outbox→共通API→Dashboardに時間が出る |
| 6 | coverage・3状態・文字数 | 末尾ジャンプ、放置、短文/長文を含めて期待どおり判定 |
| 7 | Chromeへの接続 | 同じtracker・schemaで本家閲覧を記録 |
| 8 | 集計・再読・重複 | 複数タブ・端末・再送でも定義どおりの数値 |
| 9 | privacy・削除・称号 | 非公開、停止、削除復活防止、固定称号 |
| 10 | MVP-A検証 | AndroidとPCの両方から一週間程度の自己利用などで問題を記録 |
| 11 | 最小ソーシャル | 必要になった段階で記事投稿・フィード・通報 |
| 12 | Neighbours / Race | 利用データと遊びの仮説を確認して追加 |

「一週間程度」は検証計画の提案であり、開発所要日数の見積もりではない。

工程5の時点では「時間計測の縦断ができた」と呼び、読了判定が完成したとは扱わない。工程6の時点でも、PCとAndroidの統合が未完なら全体MVP完了とはしない。

### 26.2 最初の縦断シナリオ

```text
Androidを開く
  → Readerの検索から日本語記事へ
  → GoogleでWebログインし端末連携
  → 計測に同意
  → 30秒程度の記事閲覧
  → Outboxへ保存
  → event APIで受理
  → Dashboardで記事と時間を見る
```

次にGitHub連携、英語記事、Chrome拡張、通信切断、同じ記事の再読、履歴削除の順で広げる。最初から推薦や公開フィードを足さない。

### 26.3 各工程で残すもの

設計差分、fixture、契約テスト、実機確認結果、未対応ケースをREADMEまたは`docs/verification-*`へ残す。実行していないテストを「確認済み」にしない。

実装エージェントへ渡す場合も、まずこの文書の確定/提案/未決を読み、独自に別フレームワークや全機能へ範囲を広げないようにする。

---

<a id="s27"></a>

## 27. Neighbours・ミニゲームへの拡張方針

### 27.1 Wikipedia Neighbours [方向性確定、仕様は後続]

目的は「同じ記事を読んだ人」だけでなく、**興味の重なりや、近い人が読んでいる未知の記事を楽しむこと**。

まだ確定していないのは、何を類似性として使うか、どうゲーム化するか、どのデータまで利用するか、必要な利用者数等である。

初期の検討案：

| 案 | 遊び方 | 必要な配慮 |
|---|---|---|
| 共通の入口 | 公開に同意した記事の重なりを見る | 非公開記事を理由説明へ出さない |
| 興味のつながり | 自分と相手をつなぐWikipedia記事を探す | 相手が公開を許可した範囲だけ出題 |
| 興味カード | 相手の公開記事セットから共通点を見つける | 性格・病歴等の推定ゲームにしない |
| 近所の寄り道 | Neighbourの公開おすすめを読む | 閲覧の強制や自動公開をしない |

類似性の候補として記事集合のJaccard、重み付きベクトルのcosine等を検討できるが、選定・実装済みではない。人気記事だけで全員が近くなる、少数記事で高スコアになる、再読で過度に偏る等の問題を検証する。

カテゴリを「音楽のアーティスト」と一対一対応させない。記事と分野の関係は別の分類問題として扱い、最初から分類の正しさを保証しない。

ユーザーが少ない段階では「比較に必要な記録がまだありません」と返し、架空のNeighbourや根拠のない精度を表示しない。

### 27.2 Wiki Race [後続]

既存Wikipedia_Raceを最初のゲーム候補として使う。通常レース、Daily Race、禁止記事あり等は候補であり、同時に全部作らない。

ゲームの成立には、開始・終了記事、許可された遷移、勝敗・提出、サーバー側の検証が必要。クライアントが送ったrouteを無検証でランキングへ入れない。

ランダムな2記事を選ぶだけで、必ず到達可能・面白い難易度になるとは考えない。初期の出題は手動選定または検証済みの到達例を持つ案とする。

記事のリンクは更新されるため、検証時点や対象版の方針をゲームの仕様として別途定義する。読書trackerのrevision情報だけでゲームの公平性が自動的に解決するわけではない。

### 27.3 将来を妨げないために今持つもの

安定したUser/Article ID、言語、時刻、計測元、判定version、適切な公開同意、読書とゲームの別domainがあればよい。

将来使うかもしれないという理由で、Wikipedia以外のURL、全クリック、入力文字、無制限の全文を現在から収集しない。読書経路の詳細保存も後続で個別に同意と意味を設計する。

---

<a id="s28"></a>

## 28. 主要な設計判断と採用理由

| ADR | 判断 | 採用理由 | 採らない/後回しにする案 |
|---|---|---|---|
| A01 | Last.fm型の記録を中心にする | 投稿しない人にも価値がある | タイムラインだけのSNSを先に作る |
| A02 | Androidは本家WebView | 記事レンダラーを作らず計測に集中 | API HTMLから独自Readerを一式実装 |
| A03 | Kotlin/Composeを暫定採用 | 当面Androidのみ、WebViewのホスト制御が主役 | iOS同時展開を前提としたRN/Flutter |
| A04 | trackerをTypeScriptで共有 | 計測の定義を端末で揃える | Androidと拡張で別の読了アルゴリズム |
| A05 | Native検索 | 入口のUXをアプリ側で作る | 本家検索だけに依存 |
| A06 | 検索通信はAndroidから直接 | 検索のたびのBackend依存を増やさない | 全入力をサーバーへproxy |
| A07 | 閲覧・途中まで・読了 | ユーザー指定の分かりやすい状態 | 自動/手動を別の大きな状態にする |
| A08 | 根拠は状態と別属性 | 簡潔なUIと誤認防止を両立 | 「読了」を理解の証明として扱う |
| A09 | `(wiki,page_id)` | タイトルや言語差を識別に混ぜない | URLやタイトルを主キーにする |
| A10 | opaqueな内部User UUID | 複数のログイン手段・端末を束ねる | メール一致で自動統合 |
| A11 | 冪等性と永続Outboxを初期実装 | 再送は通常動作だから | PoCの名目で二重計上を放置 |
| A12 | PostgreSQL基本、DB依存を局所化 | 現実的な本番基盤と変更余地 | SQLiteだけのテストで全DB互換を宣言 |
| A13 | 再読の履歴とユニーク数を分離 | Last.fm型の蓄積と統計の意味を両立 | 同じ記事を開くたび新しい記事数にする |
| A14 | 公開は明示、非公開が標準 | 読書内容を勝手に露出させない | 読了の自動投稿 |
| A15 | MVP-Aと最小SNSを段階化 | 読書記録の価値を先に検証 | SNS運営と推薦を全て初回必須にする |

A03などユーザーが最終的なライブラリ選定を明言していない項目は、あくまで設計上の推奨。将来「iOSを同時に作る」「Web側を既存Next.jsへ統合する」等の条件が変われば、そのADRを更新する。

この表は技術の一般的な優劣の順位ではなく、今回の小さなAndroidクライアントを作るための判断記録である。

---

<a id="s29"></a>

## 29. 未決事項・仮置き値・要件トレース

### 29.1 実装開始を妨げない未決事項

| 項目 | 仮置き | 確定が必要になる時点 |
|---|---|---|
| Webフレームワーク | React + Vite | Web scaffold作成時 |
| Kotlin採用の最終確認 | Kotlin + Compose | Android scaffold作成時 |
| minSdk / targetSdk | 未設定 | Android build設定・配布時 |
| Backendの同期/async構成 | 一方へ統一 | DB・HTTP client実装時 |
| 読書閾値・日英係数 | 本書v1の仮値 | fixture・実機テストで継続調整 |
| 最近の記事件数 | 20件ずつ | UI実装時 |
| Web timezone初期値 | Asia/Tokyo | Account実装時 |
| token有効期限 | 90日 | 認証実装時 |
| 生イベント保持 | 正式運用案90日 | 公開前 |
| 詳細UI配色・ロゴ | Material 3 / system theme | UI調整時 |
| ドメイン・application ID | 未設定 | OAuth・署名・公開設定時 |
| 配布方式 | 開発・閉じた検証から開始 | APK配布/Store公開前 |
| 初回公開に記事フィードを含むか | MVP-Aを先に検証 | 公開範囲を決める時 |
| Xログイン | 未実装・無効 | Google/GitHub完成後 |
| Neighboursの計算・ゲーム形式 | 未選定 | 記録サービス完成後 |

これらを全部ユーザーに質問してからでないと着手できない、という意味ではない。**仮置きと確定の区別を維持し、必要な工程で決定ログを更新する。**

### 29.2 変えてはいけない境界

名称`wikimf`、PC/Android/Webの役割、日英対象、3状態、イベント統一、記事IDと逆引き、Google/GitHub、非公開標準は、明示的な方針変更があるまで維持する。

「コードを書きやすいから」という理由で、勝手にFlaskへ戻す、別の読書状態を増やす、片方の言語を無効化する、検索を省く、認証手段を一つに減らすなどはしない。

### 29.3 ユーザー指定からのトレース

| ユーザーの指定 | 設計書の主な対応 |
|---|---|
| Wikipedia版Last.fm | 第1・4・14章 |
| PC/Android/Web | 第2・5・6・10・21章 |
| 日英Wikipedia | 第7・8・11章 |
| 戻る・進む・検索・メニュー | 第6・8章 |
| オートコンプリートと完全検索 | 第7章 |
| 言語は検索画面 | 第7章 |
| 最近見た記事と最近検索した記事 | 第7・20章 |
| Accountは小さくDashboardへ | 第6・21章 |
| 閲覧・読了・途中まで読んだ | 第13・14章 |
| 共通イベント | 第12・15・16章 |
| `(wiki,page_id)`とID逆引き | 第11・17章 |
| Google/GitHub、低優先X | 第18章 |
| DB変更余地 | 第19章 |
| Privacy標準 | 第20章 |
| Wikipedia Neighbours / ミニゲーム | 第22・27章 |
| 意図を残す詳細設計 | 第1・2・28・29章 |

### 29.4 実装開始時の短いチェック

```text
[ ] この文書の仮置きを採用する項目だけADRへ記録した
[ ] 名前をwikimfに統一した
[ ] 共通schemaとサンプルを先に置いた
[ ] 日英両方のfixtureを置いた
[ ] PostgreSQL統合テストの起動方法を用意した
[ ] 未送信キュー・削除・認証の境界を省略していない
[ ] Android検索→Reader→記録→Dashboardの縦断を先に作る
```

---

<a id="s30"></a>

## 30. 参照資料と検証範囲

### 30.1 会話・添付資料

本書のプロダクト要件は本会話のユーザー発言を第一の根拠とした。過去のアシスタントの提案は、ユーザーの決定と同一には扱っていない。

[^S1]: 添付ファイル `wikipedia-sns-mvp-design.md`「Wikipedia Race → Wikipedia SNS / Chrome拡張 最小MVP移植設計」、2026-09-28。対象・目的はL5-L19、再利用はL25-L39、静的指摘はL43-L53、旧構成・記事IDはL55-L69、計測はL71-L120、イベントはL122-L217、認証・公開範囲はL219-L229、実装順・受入はL231-L264を参照。本書では既存リポジトリの再取得・既存テスト実行はしていない。

### 30.2 外部仕様

以下は2026-10-04に参照した公式資料。**機能の契約や注意点を確認したものであり、実際に各APIへ認証・記事検索・WebView実行を行ったことを意味しない。** 外部仕様が要求することと、本書が提案する閾値・DB・UXは別である。

[^W1]: Last.fm, Scrobbling 2.0 Documentation。Now PlayingとScrobble、履歴への記録の概念。URL: `https://www.last.fm/api/scrobbling`

[^W2]: MediaWiki, REST API Reference。`search/title`、`search/page`、検索応答のfieldとパラメータ。URL: `https://www.mediawiki.org/wiki/API:REST_API/Reference`

[^W3]: MediaWiki, API:Search。Action APIの全文検索とcontinuation。URL: `https://www.mediawiki.org/wiki/API:Search`

[^W4]: Android Developers, WebViewCompat。origin指定のscript注入、Web message、feature検出。URL: `https://developer.android.com/reference/androidx/webkit/WebViewCompat`

[^W5]: Android Developers, Access native APIs with JavaScript bridges。bridgeの方式・公開範囲・受信情報。URL: `https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge?hl=ja`

[^W6]: Chrome for Developers, Content scripts。DOM観測とisolated world。URL: `https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts?hl=ja`

[^W7]: Chrome for Developers, The extension service worker lifecycle。workerの停止・永続状態。URL: `https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle`

[^W8]: Chrome for Developers, Extension storage API。保存先とaccess level。URL: `https://developer.chrome.com/docs/extensions/reference/api/storage`

[^W9]: MediaWiki, API:Query。page ID、タイトル、正規化、redirect等。URL: `https://www.mediawiki.org/wiki/API:Query`

[^W10]: Google for Developers, OpenID Connect。ID token、sub、server flow等。URL: `https://developers.google.com/identity/openid-connect/openid-connect`

[^W11]: GitHub Docs, Authorizing OAuth apps。web flow、state、PKCE、認証されたユーザーの取得。URL: `https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps`

[^W12]: GitHub Docs, REST API endpoints for users。認証されたユーザー情報。URL: `https://docs.github.com/en/rest/users/users#get-the-authenticated-user`

[^W13]: Android Developers, About deep links。App Linksとサイト・アプリの関連付け。URL: `https://developer.android.com/training/app-links`

[^W14]: SQLAlchemy 2.0 Documentation, The Type Hierarchy。generic型とbackend固有型。URL: `https://docs.sqlalchemy.org/en/20/core/type_basics.html`

[^W15]: Wikimedia Foundation, API Usage Guidelines。User-Agent、流量抑制、再利用、API変更。URL: `https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines`

[^W16]: Wikimedia Foundation, Terms of Use, section 7。本文・非テキストの再利用と帰属。URL: `https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use`

### 30.3 未検証事項

本書は実装設計である。Android実機、Chrome拡張、OAuth認証、RESTの実リクエスト、PostgreSQL上の並行負荷、DOM抽出精度、読書閾値、公開審査、料金、商標・ドメイン空き状況の検証結果は含まない。

特に**読了条件と推定文字数はプロダクト上の仮説**であり、既存の実測結果や研究で確定された値ではない。最初の実装と実利用を通して調整する。

---

**設計の中心：Wikipediaの表示はWikipediaに任せ、wikimfは検索の入口と、読書の足跡を安全に積み上げる体験を作る。**
