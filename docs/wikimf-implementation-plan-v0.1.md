# wikimf 実装計画書

**Last.fm for Wikipedia / 詳細設計書 v0.1 対応**

| 項目 | 内容 |
|---|---|
| 文書バージョン | 0.1 |
| 作成日 | 2026-10-04 |
| 対象 | MVP-A：PC Chrome拡張 + Android WebView Reader + Web Dashboard |
| 基準仕様 | [wikimf 詳細設計書 v0.1](wikimf-detailed-design-v0.1.md) |
| 本書の役割 | 詳細設計を、依存関係・実装タスク・成果物・受入条件・検証証跡へ分解する |
| 状態 | 実装前の計画。コード変更、API疎通、実機検証、デプロイは本書作成では実施していない |
| 想定体制 | 開発者本人を中心とする小規模開発。コーディングエージェントへのタスク引き渡しも想定 |
| 日程 | 固定しない。工程の完了条件で進行し、工数・公開日は初期実装の実績後に見積もる |

## 本書の読み方

詳細設計書が「何を、なぜ作るか」を定義するのに対し、本書は「どの順に、何を作り、何を確認したら次へ進めるか」を定義する。

**新しいプロダクト仕様で詳細設計書を上書きしない。** 原則として詳細設計書の確定・設計案・未決・後続の区分を維持する。タスクID、PR分割、検証証跡の形式、依存関係、判断期限は本書で追加した**実装計画上の提案**である。

本文の参照は「設計§15」のように詳細設計書の章・節を指す。`W05-03`などは本書の作業ID、`G05`は工程ゲート、`P01`などは本書で追加した意思決定IDである。設計書の「決定D01」と「受入テストD01」は別物なので、本書では必ず「決定」「受入」を併記する。

既存リポジトリの現在の実装は監査していない。全タスクを「実装済み」または「未実装」と断定せず、着手時に既存コードと照合する。既存実装を再利用する場合も、対応する受入条件を通して初めて完了にする。

外部仕様は詳細設計書§30の参照先を引き継ぐが、本書作成にあたって再照合・実行はしていない。API・SDK・OAuth・配布条件の確認は、該当工程の明示タスクに含める。

---

## 目次

| 章 | 内容 |
|---|---|
| 01 | [完成させるものと変更しない境界](#p01) |
| 02 | [リリースの区切りと最初の縦断](#p02) |
| 03 | [着手条件・未決事項・判断期限](#p03) |
| 04 | [工程全体と依存関係](#p04) |
| 05 | [M0：基盤・契約・検証環境](#p05) |
| 06 | [M1：Android Readerと安全なナビゲーション](#p06) |
| 07 | [M2：検索UIと端末内履歴](#p07) |
| 08 | [M3：Web認証と端末連携](#p08) |
| 09 | [M4：記事解決とID逆引き](#p09) |
| 10 | [M5：時間だけの縦断実装](#p10) |
| 11 | [M6：本文計測・3状態・手動修正](#p11) |
| 12 | [M7：Chrome拡張への接続](#p12) |
| 13 | [M8：統合集計・再読・時間と文字数](#p13) |
| 14 | [M9：プライバシー管理・削除・称号](#p14) |
| 15 | [M10：統合検証・配布準備](#p15) |
| 16 | [API・DB・共有コードの実装対応表](#p16) |
| 17 | [テストケース・検証データ・品質ゲート](#p17) |
| 18 | [開発運用・PR・実装エージェントへの渡し方](#p18) |
| 19 | [リスク・計画変更・後続機能](#p19) |
| 20 | [要件トレース・着手チェック・参照](#p20) |

---

<a id="p01"></a>

## 01. 完成させるものと変更しない境界

**根拠：設計§1〜5、§28〜29。**

### 1.1 目的

最初に完成させるのは、Wikipediaを読む場所を置き換える大規模SNSではなく、**普段の読書が一つのアカウントに積み上がり、振り返れる記録サービス**である。

Androidでは本家WikipediaをWebViewで表示し、検索の入口と計測を追加する。PCではChrome拡張が本家画面を観測する。Web Dashboardは履歴・統計・状態修正・アカウント管理の入口にする。

### 1.2 固定する境界

| 領域 | 実装で維持する内容 |
|---|---|
| 名前 | `wikimf`。`wikifm`へ「修正」しない |
| 構成 | Android、PC Chrome拡張、Web Dashboardの3つ |
| モバイル | 当面Androidのみ。iOSを完成条件に入れない |
| 言語 | `jawiki` / `enwiki`、日本語・英語の両方 |
| Reader | 本家の表示。独自記事レンダラーを作らない |
| 操作 | 上部に戻る・進む・検索・メニュー、下部にReader / Account |
| 検索 | タイトル候補、本文も含めた検索、検索画面での言語選択 |
| ゼロ入力 | 最近見た記事、最近検索した記事。任意の入力語履歴とは別 |
| Account | 小さく保ち、詳細操作はDashboardへ |
| 状態 | 閲覧 / 途中まで読んだ / 読了。根拠は別属性 |
| 記事ID | `(wiki, page_id)`と内部`article_id`。双方からの取得経路 |
| 認証 | GoogleとGitHub、providerと独立した内部User UUID |
| Backend | FastAPI + SQLAlchemy、PostgreSQLを基本にDB依存を局所化 |
| イベント | 同じschema・同じ計測定義。端末固有処理はHost Adapterへ |
| Privacy | 非公開が標準。ローカル保存・クラウド同期・公開の同意を分離 |
| 整合性 | 再送で二重計上しない。削除済み履歴を通常の再送で復活させない |

Kotlin / Compose、React / Vite、Room、Alembic等は詳細設計書の推奨案を引き継ぐ。ユーザーがライブラリまで確定したものとは扱わず、M0で採用記録を残す。

### 1.3 初期には作らないもの

MVP-Bの投稿・フィード、Neighbours、Wiki Race、Xログイン、iOS、第三言語、推薦モデル、グラフDB、リアルタイム対戦、課金、独自記事キャッシュ・オフライン記事配信は本計画のMVP-A完成条件から外す。

ただし将来機能への接続に必要なUser / Article ID、計測元、判定version、公開同意の境界は維持する。将来用の空のサービス・汎用エンジン・不要なテーブルを先に増やさない。

---

<a id="p02"></a>

## 02. リリースの区切りと最初の縦断

**根拠：設計§3、§26。区切りの名称とゲートは本書の追加提案。**

### 2.1 途中成果と完成を混同しない

| 到達点 | できること | まだ完成とは呼ばないもの |
|---|---|---|
| Reader試作：M1〜M2 | 日英記事の閲覧、戻る・進む、検索、同意済みのローカル履歴 | クラウド読書記録、読了判定 |
| Android縦断α：M5 | Androidの計上時間が自分のDashboardに出る | 本文カバー率、推定文字数、PC統合 |
| 読書判定α：M6 | 3状態、本文計測、手動修正 | 複数端末を含む全体MVP |
| 統合β：M7〜M9 | AndroidとChrome、統合集計、削除、称号 | 配布・復旧・最終検証の完了 |
| MVP-A検証完了：M10 | 固定した対象環境と範囲の受入を通過 | MVP-B、全OS・全記事形式での保証 |

中間段階の検証は、原則として開発者自身のテストアカウントと合成データで行う。第三者の継続的な読書記録を受け入れる前に、非公開・削除・端末解除・保存期間の説明を整える。

### 2.2 最初の縦断シナリオ

```text
Android Readerを起動
  → 検索で日本語の通常記事を選ぶ
  → 外部ブラウザでGoogleログイン
  → 明示的に端末を承認
  → アプリへ戻り、クラウド記録に同意
  → 記事を30秒程度アクティブに閲覧
  → 同梱trackerが観測
  → Room Outboxに保存
  → 共通APIで受理・commit
  → 同じUserのDashboardで記事と時間を見る
```

この時点の本文計測は`time_only`でよく、UIに未実装の読了率・推定文字数を出さない。Googleで最初の線を通しても、**GitHubをMVPから除外しない**。M3の完了条件は両providerを含む。

### 2.3 完成版の縦断シナリオ

```text
Androidで日本語記事を検索し、途中まで読む
  → Chromeで英語記事を読む
  → 同一アカウントのDashboardに両方が現れる
  → 同じ記事を再読すると活動だけ増え、記事種類数は増えない
  → 手動で状態を変更しても時間は増えない
  → オフライン記録が復帰後に一度だけ同期される
  → 履歴を削除すると統計・称号も更新される
  → 旧キューの再送で削除した記録が復活しない
```

「記録が勝手に育つ」という仮説は、計測精度・検索の使いやすさ・削除の安心感とセットで評価する。機能の数ではなく、この一連の利用が破綻しないことを優先する。

---

<a id="p03"></a>

## 03. 着手条件・未決事項・判断期限

**根拠：設計§9、§15〜20、§23、§29。具体的な判断期限は本書の追加提案。**

### 3.1 判断を先送りしない場所

未決事項があるたび開発全体を止めるのではなく、**その判断に依存する実装の前**にADRへ残す。既存設計と異なる決定をする場合は、詳細設計書の変更も同じPRに含める。

| ID | 判断すること | 出発点・不足している内容 | 決定期限 |
|---|---|---|---|
| P01 | 技術構成とバージョン | Kotlin/Compose、React/Vite、Room、Alembic等は推奨案。SDK・ライブラリ番号は未設定 | M0〜M1のscaffold |
| P02 | Backend同期/async | 詳細設計はどちらかへ統一する方針まで。採用ライブラリと接続方式を決める | M0のDB/HTTP層 |
| P03 | イベントの厳密なschema | `time_only`理由フィールド、zero intervalのclosed、canonical JSONの数値/null規則等の細部は未固定 | M5の契約凍結前 |
| P04 | 重複時間のsession帰属 | 総時間と記事帰属の方針はある。同じ記事の並行sessionにどのaccepted時間を割り当てるかまで固定する | M5の計上処理、M8で検証 |
| P05 | 記録制御情報の配信 | epoch・記事削除marker・同意/停止の取得とクライアントcache無効化の具体契約は未固定 | M5の制御枠、M9の削除実装前 |
| P06 | 認証と実環境設定 | OAuth登録、redirect URI、scope、session期限、端末token期限、連携要求の制限 | M3 |
| P07 | 状態・文字数・称号の初期値 | 詳細設計v1の仮値を基準とする。実測済み閾値とは扱わない | M6でversionを固定、M10で評価 |
| P08 | Accountの件数ラベル | 手動のみの読了は自動閲覧数に含まれないため、「うち読了」と無条件に表示すると内訳が矛盾し得る | M6の統計UI |
| P09 | 公開プロフィールAPI | 独立schemaの方針はあるが、公開用path・公開項目・slug/IDの仕様は未固定 | M9 |
| P10 | 一覧・exportの応答詳細 | cursor、timezone、期間フィルタ、JSON exportの範囲・生成方式・取得方法 | M8〜M9 |
| P11 | 配布・ドメイン・識別子 | application ID、署名、ホスト、公開ドメイン、Chrome拡張の配布方法は未決 | OAuthはM3、配布固定はM10前 |
| P12 | 保持・削除・backup | 詳細event保持、圧縮後の根拠、削除marker寿命、backupへの削除反映 | 外部利用者の受入・公開前 |
| P13 | 初回公開の範囲 | MVP-Aを先に検証する。初回一般公開にMVP-Bを含めるかは未決 | 公開判断時 |

P03〜P05、P08〜P10は、本書作成時に**実装契約へ落とすには追加決定が必要**と整理した項目である。仕様の不備を黙って別ルールへ置き換えるのではなく、fixtureとADRで明示する。

### 3.2 特に固定すべき計算の境界

**P04：時間帰属の案。** 受理順を固定し、まだ計上されていない区間を該当event/sessionへ割り当てる実装を候補にする。これを採る場合、sessionの読了条件に使うTも、割り当て後のaccepted時間から求める。別sessionの時間を借りて読了にしない。採用はADRで確定し、記事別合計・session別合計・全体の整合をテストする。

**P08：件数の案。** Accountでは「自動閲覧記事数」と「読了記事数」を別指標として表示するか、「うち読了」を自動閲覧対象だけの内訳に限定する。手動だけで読了にした記事の扱いを決めずにUIを作らない。どちらでも、設計§14・17の集計定義は崩さない。

**P05：制御同期の案。** 起動・連携・同期再開時に、現在のepochと必要な削除情報を取り直せる契約を用意する。新規endpointにするか既存の認証済み応答へ含めるかはM0で枠を決め、M9前に固定する。本文に未定義のAPIが「既にある」とは仮定しない。

### 3.3 実環境で必要になるもの

OAuthの実ログインにはGoogle/GitHub側のアプリ登録と秘密値、外部公開にはHTTPSの到達先、配布にはAndroidの識別子・署名管理が必要になる。これらは開発者が管理する設定として扱い、サンプルの秘密値や他人の設定を流用しない。

設定がまだない工程でも、provider adapter・失敗ケース・連携UIはfake providerで開発できる。ただし**mockで通ったことをGoogle/GitHub実連携確認に置き換えない**。実連携が未実施なら、M3/M10の該当ゲートは未完のまま残す。

---

<a id="p04"></a>

## 04. 工程全体と依存関係

**根拠：設計§26の工程0〜10。ここでは同じ順序をM0〜M10として詳細化する。**

### 4.1 マイルストーン一覧

| 工程 | 主な成果 | 主な依存 | 工程ゲート |
|---|---|---|---|
| M0 | リポジトリ基準、契約、API/DB/CI、試験fixture | なし | G00：再現可能な開発基盤 |
| M1 | 薄いAndroid Reader、安全な遷移、前後移動 | M0 | G01：日英を安全に読める |
| M2 | 検索、言語、入力状態、2種のローカル履歴 | M1 | G02：検索から記事へ進める |
| M3 | Webログイン、Google/GitHub、端末連携 | M0。Android統合はM1 | G03：同一Userへ安全に連携 |
| M4 | Article ResolverとID逆引き | M0。保護APIはM3 | G04：識別方法が変わっても同一Article |
| M5 | time_only観測→Outbox→API→Dashboard | M2・M3・M4 | G05：Androidで時間だけの縦断 |
| M6 | coverage、3状態、文字数、手動修正 | M5 | G06：計測根拠と状態が一致 |
| M7 | ChromeのHost Adapter、Outbox、popup | M3〜M6 | G07：共通trackerでPCも記録 |
| M8 | 再読・複数端末・期間統計・再計算 | M5〜M7 | G08：集計を再現できる |
| M9 | 停止・削除・export・称号・公開境界 | M3・M8 | G09：個人情報を管理できる |
| M10 | 統合・実機・復旧・配布・利用評価 | M1〜M9 | G10：MVP-Aの受入判定 |

### 4.2 依存関係の見取り図

```text
M0 基盤・契約
 ├─ M1 Reader ─ M2 Search ────────────┐
 ├─ M3 認証・端末連携 ────────────────┤
 └─ M4 記事識別・逆引き ──────────────┤
                                      ▼
                        M5 Android時間縦断
                                      ▼
                        M6 coverage・3状態
                                      ▼
                        M7 Chrome接続
                                      ▼
                        M8 統合集計・再計算
                                      ▼
                        M9 削除・管理・称号
                                      ▼
                        M10 統合受入・配布準備
```

M3とM4の内部開発、DOM fixtureの収集、検索画面の見た目調整は、契約が定まれば並行可能。M4の保護API統合はM3を待つ。工程ゲートを通る前に、次工程の調査やfixture作成を行ってはいけないという意味ではない。

### 4.3 早期から入れるもの

プライバシーをM9で初めて考える計画にはしない。**非公開初期値・ユーザー分離はM3、epoch・immutable event・冪等性・トランザクションはM0/M5から**実装する。M9は削除と管理のフローを完成させる工程である。

同様に、M8まで二重送信を許容しない。単一sessionの重複排除と時間の基本計上はM5で通す。M8で異なる端末、遅延到着、期間分割、再計算を組み合わせて検証する。

### 4.4 タスクの単位

以下のWBSは52作業単位。1作業単位は必ずしも1PRではない。大きいものはDB / domain / API / UIに分け、小さいものは同じ境界でまとめてよい。

すべての作業で、**実装・テスト・必要なmigration・文書差分**を成果物に含める。コードを追加しただけでは完了にしない。


<a id="p05"></a>

## 05. M0：基盤・契約・検証環境

**狙い：後続のAndroid・Chrome・Backendで意味がずれない足場を先に作る。**

ここに記すディレクトリ・ファイル名は実装先の提案であり、現在存在するコードを示すものではない。

### W00-01：仕様基準と実装ベースラインを固定する

**依存**：なし  
**成果物**：`docs/design/`、`docs/implementation/`、`docs/adr/`、現行コード監査メモ  
**仕様参照**：設計§2・22・28〜30

**作業内容**：詳細設計書v0.1を保存し、合意事項・設計案・未決を抽出する。作業対象リポジトリの有無と現在のcommitを確認し、既存実装・テスト・不足を照合する。旧Wikipedia_Raceを使う場合は移植元commitを記録し、現行動作を別に確認する。P01〜P13の担当と判断期限を登録する。

**完了条件**：参照する設計version、対象commit、未決事項の場所が明確。Flask・SQLite・日本語のみの旧前提が今回の仕様として混入していない。

**検証**：文書レビュー。既存テストを実行した場合はpass/fail/skip/未実行を区別して記録する。

### W00-02：最小モノレポと再現可能なビルドを用意する

**依存**：W00-01、P01・P02  
**成果物**：`apps/android`、`apps/extension`、`apps/web`、`packages/wiki-tracker`、`packages/contracts`、`backend`、lockfile、`.env.example`  
**仕様参照**：設計§5・9・23・29

**作業内容**：採用するPython/Node/Kotlin/Gradle/SDK等の組合せを確認して固定する。FastAPI起動、空のAndroidアプリ、Web静的画面、拡張の最小build、tracker bundleを用意する。WebはReact/Vite案、AndroidはKotlin/Compose案を採用する場合にADRへ記録する。未決の本番URL・秘密値をコードへ埋めない。

**完了条件**：手順書に従って新規環境で各成果物をbuildできる。設定不足は起動・設定画面で分かり、安全でない既定tokenを補わない。

**検証**：clean checkout相当からのbuild。依存のlock、生成物の差分、開発/配布設定の分離を確認する。

### W00-03：共有契約の原本と生成手順を作る

**依存**：W00-02、P03の初期決定  
**成果物**：Pydanticモデル、JSON Schema、生成TS型/Kotlinモデル、`tests/contracts/`、代表JSON  
**仕様参照**：設計§5.1・15〜17

**作業内容**：ReadingEventの3種類、ok/time_only、source、User/Article識別を定義する。API原本をPydanticへ寄せ、TS・Kotlinで手書きの別仕様を増やさない。Kotlinの生成経路が対応しないschema機能は最小sampleで確認し、契約自体を変更するならADRにする。epoch、session_started_at、immutable event、item ACKを最初から含める。

**完了条件**：同じvalid/invalid fixtureをPython・TS・Kotlinで読み、許可・拒否が一致する。生成差分がCIで検出される。未決fieldは実装コードの独断で補われていない。

**検証**：未知field/version、nullと0、負値、source不一致、time_only理由欠落、数値/文字列混同、payload上限のschemaテスト。

### W00-04：PostgreSQL・migration・transaction境界を準備する

**依存**：W00-02、P02  
**成果物**：SQLAlchemy engine/session管理、Alembic基盤、開発用Compose、DB統合テスト用fixture  
**仕様参照**：設計§19・23

**作業内容**：DB URL注入、UTC・UUIDの方針、request/service単位のsession境界を揃える。初期migrationは必要な基礎schemaに絞り、機能tableは各工程で追加する。同一ユーザー更新を直列化する境界を用意し、DB固有ロックをdomainへ散らさない。SQLiteを使う場合の制約も記載する。

**完了条件**：空のPostgreSQLへmigrationでき、transaction rollbackが確認できる。接続文字列を変えるだけで全DB対応と説明しない。

**検証**：migrationの空DB適用、接続/commit失敗、UUID・UTC round trip。実際のPostgreSQLで実行する。

### W00-05：テストfixture・CI・開発コマンドを整える

**依存**：W00-02〜W00-04  
**成果物**：`tests/fixtures/`、CI workflow、開発コマンド、検証記録テンプレート  
**仕様参照**：設計§24〜26

**作業内容**：固定のWikipedia応答、日英DOM、単調時計、OAuth fake、ネットワーク障害を差し替えられるようにする。通常CIを外部APIなしで実行できる構成にする。Python unit/PG integration、TS contract/DOM、Kotlin unit、Android assemble、Web/拡張buildを必要な順に増やす。

**完了条件**：代表的な失敗fixtureをCIが検出する。実機・実サイトテストが未実行のとき、unitの成功で代替されない。

**検証**：意図的に不正schema・型・fixture期待値を入れた場合のCI失敗を確認し、元に戻す。テストログの秘密情報検査。

### W00-06：WebView・検索API・認証の技術的な不確実性を小さく検証する

**依存**：W00-02、P01・P06の調査  
**成果物**：`docs/spikes/`、対応機能マトリクス、採用API/ライブラリの判断記録  
**仕様参照**：設計§7.6・9・18・30

**作業内容**：固定するAndroidX/WebViewの安全な注入・origin付きbridge・機能検出を最小構成で確認する。日英の候補/本文検索の応答形、Google/GitHubの採用フローとライブラリ対応を公式資料と少数の実行で確認する。認証設定が未準備なら調査とfake検証を区別する。対応しない機能はReaderのみへ降格する方針を保つ。

**完了条件**：安全なbridgeが成立する条件と、非対応時の挙動が分かる。検索や認証の未確認点を「動くはず」で消さない。未実行の実認証はM3の残件として残る。

**検証**：許可/不許可origin、main/sub frame、機能非対応の試験。検索の実応答を匿名のfixtureへ整形し、取得日と参照先を記録する。

### G00：M0の完了条件

- [ ] 採用する仕様・仮置き・未決の境界が記録されている。
- [ ] API、PostgreSQL、Android、Web、拡張、trackerの最小buildが再現できる。
- [ ] 契約の生成と代表fixtureの検証が動く。
- [ ] 重要なSDK・API上の不確実性に、確認結果または明確な残件がある。
- [ ] `.env.example`、ログ、生成物に本物の秘密値が入っていない。

---

<a id="p06"></a>

## 06. M1：Android Readerと安全なナビゲーション

**狙い：計測がまだなくても、日英Wikipediaを迷わず読める状態にする。**

### W01-01：Reader / Accountとトップバーを実装する

**依存**：W00-02、W00-06  
**成果物**：`ReaderScreen`、`WikipediaWebView`、最小`AccountScreen`、アプリ内navigation  
**仕様参照**：設計§6・9

**作業内容**：上部に戻る・進む・検索・メニュー、下部にReader/Accountを配置する。検索は一時的な画面導線まで用意し、言語選択はトップバーへ追加しない。WebViewの再生成と通常のCompose再描画を分離する。本家ヘッダーやライセンス表示を隠さない。

**完了条件**：日本語・英語の本家ページを開ける。前後履歴とボタン状態が一致し、履歴がないときは無効。Accountは最小表示に留まる。

**検証**：受入N01〜N04、N10。長いタイトル・狭い画面でも操作がはみ出さない。

### W01-02：URLポリシーと外部ブラウザ遷移を実装する

**依存**：W01-01  
**成果物**：`WikipediaNavigation`、URL分類器、外部確認UI、共有URL生成  
**仕様参照**：設計§6.1・8

**作業内容**：scheme/host/port/userinfoをparserで確認し、日英のHTTPS originだけを内蔵Readerへ許可する。トップレベル遷移と画像等のサブリソースを分ける。外部リンク、新規window、redirect、アンカーを扱い、無人popupや任意Intentの起動を防ぐ。編集・ログイン等の扱いを設計どおりに分ける。

**完了条件**：通常リンクとtarget=_blankが同じ安全規則を通る。画像やCSSを壊さず、許可外ページへbridgeを持ち出さない。OS共有は公開投稿を作らない。

**検証**：受入N05〜N09、N13。偽サブドメイン、port、userinfo、http、非Web scheme、外部redirectをfixture化。

### W01-03：ライフサイクルと戻る操作を固定する

**依存**：W01-01〜W01-02  
**成果物**：WebView状態管理、HostState、戻る処理、renderer障害UI  
**仕様参照**：設計§6.5・8.5・9.2・9.5

**作業内容**：キーボード→ダイアログ→検索→Account→WebView履歴→OS標準の順序で戻る操作を処理する。Reader/Account切替、回転、プロセス復帰、画面ロック、外部ブラウザ復帰の状態を整理する。WebViewをViewModelへ長期保持してActivityを巻き込む設計にしない。renderer停止・SSL異常の回復導線を作る。

**完了条件**：画面切替で位置と前後履歴を不要に失わない。プロセス喪失後は新sessionの前提になる。SSLエラーを無視して表示継続しない。

**検証**：受入N10〜N14。OSバックと上部戻るの意味を別々に実機確認する。

### W01-04：安全なtracker接続口と機能降格を組み込む

**依存**：W00-03、W00-06、W01-03  
**成果物**：`TrackerBridge`、Android Host Adapter、feature検出、診断UI  
**仕様参照**：設計§9・12

**作業内容**：同梱JSの注入と観測メッセージ受信だけを用意する。origin/main frame/schema/payload長/sessionを検査する。token取得・任意fetch・ファイル・Intentをbridgeへ公開しない。Readerが検索やAccountに覆われていることをHostStateで通知する。この工程では本番イベント送信をまだ有効化しない。

**完了条件**：安全なbridgeが非対応でもReaderは動き、計測できない理由が分かる。JS側へ秘密値が渡らない。

**検証**：不許可origin、iframe、過大payload、不正JSON、偽session、HostState切替の検証。受入R07の接続基盤。

### G01：M1の完了条件

日英本家表示、前後移動、外部リンク、OSバック、タブ切替、基本的な状態復元が動く。安全な計測ができない環境ではReaderだけを提供する。認証や計測が未実装でも、完成しているような統計は表示しない。

---

<a id="p07"></a>

## 07. M2：検索UIと端末内履歴

**狙い：今回こだわる検索画面を、見た目だけでなくIME・応答逆転・失敗時まで完成させる。**

### W02-01：Wikipedia検索クライアントを作る

**依存**：W00-03、W00-06、W01-02  
**成果物**：`WikipediaSearchClient`、`SearchHit`、検索用HTTP fixture  
**仕様参照**：設計§7.3・7.6・23.4

**作業内容**：AndroidのNative HTTPから日英のタイトル検索と本文検索へ直接問い合わせる。description/excerpt欠落、0件、HTTPエラーを分ける。HTML断片は安全なテキストへ変換し、本文として実行しない。timeout・限定retry・短命cache・呼び出し元識別を整える。MVPは候補10件/本文20件の仮値で開始し、架空のページング引数を追加しない。

**完了条件**：双方の言語・modeで正しいモデルを返す。検索語をwikimfの記録APIや通常ログへ送らない。画像なしで成立する。

**検証**：受入S09〜S12。429、5xx、通信断、説明なし、HTML、長いタイトルを固定応答で確認。

### W02-02：検索状態とリクエスト競合を制御する

**依存**：W02-01  
**成果物**：`SearchViewModel`、検索state、仮想時間テスト  
**仕様参照**：設計§7.2〜7.4

**作業内容**：empty/suggesting/searching/resultsとloading/errorを設計どおりに定義する。1文字・300ms debounce、IME変換中の抑制、Enter/IME検索/本文検索行、入力消去を実装する。cancelに加えてlanguage/query/mode/request_idの世代一致を確認する。言語を変更しても背後の記事は動かさない。

**完了条件**：古い候補や別言語の応答が現在の結果を上書きしない。候補と本文検索結果を混ぜない。

**検証**：受入S02〜S04、S08〜S10、S14。日本語の変換確定、連打、戻る直後の応答も検証。

### W02-03：ゼロ入力の履歴とローカル同意を実装する

**依存**：W02-02、W01-01  
**成果物**：RoomのRecentViewed/RecentSearched、履歴同意・保存停止・削除UI  
**仕様参照**：設計§6.4・7.5・20

**作業内容**：通常記事の正常表示時と検索候補/結果の選択時を別の登録契機にする。ゲスト/アカウント別に保存し、初期各20件・表示5件を仮置きする。未確定IDはローカルURLで保持し、後で正規IDへ統合する。候補表示だけ・途中入力だけでは保存しない。各行/全消去、保存停止、記録停止との接続口を用意する。

**完了条件**：同意前には端末履歴も保存しない。ログインしてもゲスト履歴をクラウドへ遡及送信しない。アカウント切替で他の履歴が見えない。

**検証**：受入S01、S05〜S07、S13。再選択時の先頭移動、言語優先、20件上限、正常表示失敗を確認。

### W02-04：検索画面を仕上げ、Readerへ接続する

**依存**：W02-01〜W02-03、W01-03  
**成果物**：`SearchScreen`、候補/結果row、zero-state、空/エラーUI、画面検証記録  
**仕様参照**：設計§6.2・7・24

**作業内容**：余白、タイトル/説明の階層、クリア、言語2択、本文検索への導線を実装する。ライト/ダーク、大きな文字、TalkBack、48dpのタップ領域を設計目標にする。履歴選択と本家検索へのfallbackを用意し、検索表示中はHostStateを停止する。既読やNeighbour表示は追加しない。

**完了条件**：入力なし→候補→本文検索→記事→戻るが自然につながる。説明や画像がなくても欠落UIが破綻せず、エラーと0件が見分けられる。

**検証**：受入S01〜S14、R07。実機の日本語IMEと英語入力、片手操作、文字拡大、dark modeを確認する。

### G02：M2の完了条件

候補検索と本文検索、言語選択、2種類の最近の記事がすべて利用できる。検索UIの見た目は実機で確認し、API成功画面だけで完成にしない。クラウド未接続でも閲覧と検索を利用できる。

---

<a id="p08"></a>

## 08. M3：Web認証と端末連携

**狙い：PC・Android・Dashboardを、同じ本人の内部User IDへ結び付ける。**

### W03-01：User・Identity・Web sessionを実装する

**依存**：W00-03〜W00-04、P06  
**成果物**：users/auth_identities/web_sessions/privacyのmigration、認証context、`GET /me`  
**仕様参照**：設計§17〜20

**作業内容**：内部UUID、provider subject一意制約、非公開初期値、同意version、recording_epochを用意する。Web sessionは秘密値の安全な保管と期限を持たせる。個人APIは認証contextからUserを取得し、bodyのuser_idを権威にしない。cookie属性、CSRF、認証失敗のエラーを統一する。

**完了条件**：別ユーザーのデータにID指定で到達しない。メールのないアカウントでもモデルが成立する。新規ユーザーの公開範囲はOFF。

**検証**：受入D10、D13、D21、D24。User/identity一意制約、session期限/失効、CSRFを統合テスト。

### W03-02：GoogleとGitHubのログインを接続する

**依存**：W03-01、P06  
**成果物**：provider adapter、start/callback/logout、Webログイン画面、設定手順  
**仕様参照**：設計§18.1〜18.3・18.7

**作業内容**：GoogleのOIDCとGitHubのOAuth後の本人ID取得を、それぞれの採用方式で実装する。state、nonceの適用箇所、PKCE対応、redirect allowlistを確認する。最小scopeにし、provider secretはBackendだけに置く。ログイン結果を端末tokenとして流用しない。

**完了条件**：両providerで新規登録・再ログイン・キャンセル・期限切れ・エラーを処理できる。Xの未実装ボタンを出さない。

**検証**：fake providerの異常系に加え、管理された実アカウントで両providerの実ログインを確認。設定不足のskipを完了に数えない。

### W03-03：認証手段の追加・解除を実装する

**依存**：W03-02  
**成果物**：`/me/identities`関連API、Identity管理UI、連携監査ログの最小情報  
**仕様参照**：設計§17.1・18.6

**作業内容**：ログイン済みUserから別providerを追加し、同じUser UUIDへ関連付ける。メール一致で自動mergeしない。別Userに紐づくidentityの取得、最後のidentity解除、途中でのアカウント混同を防ぐ。解除や追加に必要な再認証条件をP06に記録する。

**完了条件**：Googleで作ったUserへGitHubを明示追加した後、どちらでログインしても同じUserになる。別ユーザーの自動mergeは提供しない。

**検証**：受入D15〜D17。別identityで未ログインから登録した場合も、勝手に既存Userへ結合しない。

### W03-04：端末連携grantと端末tokenを実装する

**依存**：W03-01〜W03-02、P06  
**成果物**：devices/device_link_requestsのmigration、連携API、承認Web画面、token検証  
**仕様参照**：設計§17.1・18.4〜18.5

**作業内容**：端末秘密値と確認コードを分離し、ユーザーによる承認後に一回だけ交換する。5分期限等の仮値、試行回数、poll間隔、source/scopeの検査を設定化する。秘密値をURLやログへ入れず、tokenはhashで保存する。交換ACK紛失は新しい連携でやり直せるようにする。

**完了条件**：短い確認コード単独ではtokenを取得できない。未承認・期限切れ・二重交換・別device/sourceは拒否される。端末tokenのscopeをサーバーで強制する。

**検証**：受入D08、D10、D21。追加P-AUTH-01：grant再使用・別端末からの交換・承認CSRF・token漏洩検査。

### W03-05：Android Accountと端末管理を接続する

**依存**：W03-03〜W03-04、W01-03  
**成果物**：Android認証adapter、保護token保管、最小Account、Web端末一覧  
**仕様参照**：設計§6.3・9.5・18

**作業内容**：外部ブラウザで連携し、アプリへ戻って確認できる導線を実装する。App Links未設定でも手動確認で成立させる。計測同意はログインと分ける。ログアウト・端末解除・期限切れに対応し、後続Outboxの未送信件数確認用の接続口を置く。Dashboardはbridge付きWebViewでは開かない。

**完了条件**：本人の表示名と端末の連携状態が確認できる。JSやcontentにtokenが届かない。端末解除後のAPIは拒否され、他アカウントへ資格情報を流用しない。

**検証**：実機でGoogle/GitHub両方の連携導線、戻り操作、端末解除。受入D08、D16、D21。

### G03：M3の完了条件

GoogleとGitHubの両方を使える。同じユーザーへのidentity追加と、Androidの端末連携が成立する。認証だけで記録同意・公開同意を済ませた扱いにしない。実認証未確認なら、M3の最終ゲートは未完である。

---

<a id="p09"></a>

## 09. M4：記事解決とID逆引き

**狙い：記事の参照方法が変わっても、同じArticleへ到達できるようにする。**

### W04-01：MediaWikiClientとURL正規化の入口を作る

**依存**：W00-03〜W00-05、P02  
**成果物**：`backend/articles/`のAPI adapter、URL parser、cache/retry fixture  
**仕様参照**：設計§11・22〜23

**作業内容**：ja/enの固定API先だけへ通信し、ユーザー指定URLを任意fetchしない。タイトル、curid、pageids、redirect、continueを扱う。HTTP 200内のAPIエラーも分類する。timeout、総retry時間、Retry-After、上限を定義する。既存Raceから移植する場合は小さな純粋部品とfixtureに限定する。

**完了条件**：不正URL・矛盾した識別子・未知wikiを拒否する。API障害と記事missingを混同せず、継続トークンを落とさない。

**検証**：受入D18、N07。API 200 error、429、5xx、malformed URL、redirect循環/上限、cache hitを検証。

### W04-02：Article Resolverと正規キーを永続化する

**依存**：W04-01、W00-04  
**成果物**：articles/必要なaliasesのmigration、resolver service、trackable判定  
**仕様参照**：設計§11・19

**作業内容**：UNIQUE(wiki,page_id)と内部UUIDを実装する。namespace、曖昧さ回避、canonical URL、metadata freshnessを持つ。ページモードによる計測可否と記事自体の属性を分ける。表示版が確認できない場合はobserved_revisionをnullのままにし、最新revisionを代入しない。

**完了条件**：同時に解決してもArticleが重複しない。同名でもwikiが違えば別記事。改名・redirect・削除再作成を設計どおり扱える。

**検証**：受入D09、D18、R13、R15。URL/タイトル/IDの一致、並列作成、missing/stale、nullable revision。

### W04-03：逆引きとbatch取得APIを公開する

**依存**：W04-02、W03-01  
**成果物**：`POST /articles/resolve`、2種のGET逆引き、`POST /articles/batch-get`、OpenAPI  
**仕様参照**：設計§11.3・17.2〜17.3

**作業内容**：内部UUIDとwiki/page IDの両方からArticleを取得する。cache補充で読書状態を作らない。複数IDの取得上限、missing、stale、無権限の扱いを契約に固定する。個人の既読情報や統計をメタデータ応答に混ぜない。

**完了条件**：4経路が同じarticle_idと正規情報へ収束する。unknown/失敗/削除済み記事が明示される。

**検証**：受入D18、D24。逆引きの前後でactivities/statsが増えないことを確認する。

### W04-04：Android・検索履歴・trackerの参照を統合する

**依存**：W04-03、W02-03、W01-04  
**成果物**：Android Article adapter、ローカル履歴のID統合、pending参照モデル  
**仕様参照**：設計§7.5・11・16.5

**作業内容**：検索HitやReader URLを正規Articleへ結び付ける。Backend障害時も検索・表示は止めず、未解決参照は端末内に分離する。正式イベントはarticle_idが解決してから確定する設計へ接続する。記事解決のために10秒ごとの観測でWikipedia APIを呼ばない。

**完了条件**：同じ記事のURL別履歴が解決後に統合される。API未解決状態を読了や記録成功として表示しない。

**検証**：オフライン、遅いResolver、記事遷移後に旧応答が届く場合、redirect後のローカル統合。受入D09、D18。

### G04：M4の完了条件

URL、`(wiki,page_id)`、内部UUIDで同じArticleに到達できる。記事メタデータの参照だけでは実績を増やさない。日英・redirect・missing・staleを区別し、検索とReaderが解決障害に巻き込まれない。

---


<a id="p10"></a>

## 10. M5：時間だけの縦断実装

**狙い：最小の観測を、失わず・混ぜず・二重計上せずにDashboardまで届ける。**

この工程で`event_id`、`seq`、永続Outbox、token分離、epochを省略しない。後回しにするのは本文カバー率と高度な統計であり、同期の基本整合性ではない。

### W05-01：共通trackerの時間計測を実装する

**依存**：W00-03、W01-04、W04-04、P03  
**成果物**：`packages/wiki-tracker/active-time`、Host契約、time_onlyイベント生成  
**仕様参照**：設計§9.6・12・15

**作業内容**：単調時計、visible、Hostの前面状態、同意、対象記事、idleを組み合わせる。tick約1秒、gap2秒超は除外、idle60秒等は設計v1の仮値として設定化する。検索/Account/lock/外部遷移で止め、closed未着でも復元できるsnapshotを作る。time_onlyの理由とnullableなDocument情報を正しく出す。

**完了条件**：許可されたactive区間だけがイベントになる。停止期間やsleepを遡って加算せず、キー内容・本文・外部URLを出力しない。

**検証**：受入R01〜R02、R06〜R08、R11、R13。仮想時計、時刻jump、短いactive区間、長い空白で検証。

### W05-02：Androidの永続Outboxとpending解決を実装する

**依存**：W05-01、W04-04、W03-05  
**成果物**：Room Outbox/pendingモデル、immutable event保存、queue状態  
**仕様参照**：設計§15〜16・20

**作業内容**：観測を先に永続化し、10秒程度または状態変化時に保存する。未解決記事は正式イベントとは別のpending envelopeにし、解決後に初めてpayloadを確定する。作成時のUser/device/epochを保持し、別tokenで送らない。7日/10MiB等の上限、停止、破棄、未送信表示を実装する。

**完了条件**：プロセスkill後も保存済みデータは残る。同じevent_idの内容を書き換えない。満杯時に無言上書きしない。ログアウト時に未送信を確認できる。

**検証**：受入D05、D08、D22。保存途中の終了、記事解決失敗、アカウント切替、サイズ境界、許容損失を確認。

### W05-03：共通イベント受付と基本時間計上を実装する

**依存**：W05-01、W03-04、W04-03、W00-04、P03〜P05の初期契約  
**成果物**：`POST /reading-events/batch`、sessions/events/intervalsのmigration、冪等受付service  
**仕様参照**：設計§14.3〜14.4・15〜19

**作業内容**：tokenからUser/device/sourceを確定し、記事とsessionの不変条件、schema、epoch、同意を検査する。canonical payload digest、一意制約、同一Userの直列化、item単位transactionを実装する。同じpayloadはduplicate、内容相違はconflict。valid intervalから時間を計上し、受理済み同一区間を増やさない。commit後だけacceptedを返す。

**完了条件**：再送・ACK紛失・同時INSERTでも一度分。個別itemの異常で正常itemを勝手に破棄しない。active累積値だけで未着時間を埋めない。時間帰属はP04で定めた規則に従う。

**検証**：受入D01〜D04、D07、D09〜D10、D23。DB失敗後の再送、zero interval、open/closed欠落、逆順、認証不一致。

### W05-04：Androidの同期と再送・認証エラー処理を実装する

**依存**：W05-02〜W05-03、W03-05  
**成果物**：foreground送信、WorkManager連携、backoff、item ACK処理、同期UI  
**仕様参照**：設計§16・18・20

**作業内容**：accepted/duplicateだけを削除し、rejectedは隔離、retryableは維持する。401/403、413、422、429、5xxを区別し、batchをサイズで分割する。前面中の送信とOS制約下の再送を分け、バックグラウンドの10秒間隔保証はしない。epoch変更等の制御応答を処理できる接続口を入れる。

**完了条件**：一部成功・通信切断でも正しい残件だけが残る。失効や同意撤回中に送信を続けず、別アカウントへ付け替えない。

**検証**：受入D04〜D05、D08、D22〜D23。ACK紛失、部分成功、413単体超過、Retry-After、ネットワーク切替。

### W05-05：時間だけのDashboardとAccountを接続する

**依存**：W05-03、W03-02、W03-05  
**成果物**：`GET /me/activities`、記事一覧/記録の最小read API、時間版stats、Dashboard Overview/Activity  
**仕様参照**：設計§6.3・14・17・21

**作業内容**：qualified sessionを活動履歴として表示し、heartbeatの件数を活動回数にしない。自分の記事と時間、source、同期状態を最小表示する。time_onlyではcoverageやcompletedを捏造せず、未対応指標を非表示または説明付きにする。個人応答のcacheと認可を整える。

**完了条件**：Androidと外部ブラウザのDashboardで同じUserの記事と時間が見える。短時間離脱とナビゲーション用履歴を混同しない。

**検証**：受入R01〜R02、D10、D24。2ユーザー同時利用、空データ、API停止、認証切れのUI。

### W05-06：最初の縦断と基本障害を実機で通す

**依存**：W05-01〜W05-05  
**成果物**：`docs/verification/m05-*`、縦断テスト、既知制約一覧  
**仕様参照**：設計§24〜26

**作業内容**：Android検索→日英記事→同意→計測→Outbox→API→Dashboardを通す。飛行機モードから復帰、強制終了、Backend停止、ログアウトを追加する。計測中・停止中・未送信・再連携待ちを見分けられることを確認する。Google/GitHub双方のUser連携を含める。

**完了条件**：時間だけの縦断αとして利用できる。まだ本文読了推定・PC統合が未完であることをUI/記録に残す。

**検証**：受入N01〜N02、R06〜R08、D01、D04〜D05、D08。現物の端末/WebView versionと対象commitを証跡に残す。

### G05：M5の完了条件

- [ ] Androidで計測した時間が同じUserのDashboardに現れる。
- [ ] 同意前・停止中・検索/Account表示中には新しい読書時間を加算しない。
- [ ] オフライン後、同じイベントの再送が二重計上されない。
- [ ] 保存済みキューは再起動後に復旧し、他アカウントへ混入しない。
- [ ] `time_only`を読了・文字数計測の完成として表示していない。

---

<a id="p11"></a>

## 11. M6：本文計測・3状態・手動修正

**狙い：観測可能な根拠だけで状態を推定し、利用者が修正できるようにする。**

### W06-01：日英の本文抽出とchunk定義を実装する

**依存**：W05-01、W00-05  
**成果物**：version付きDOM adapter、chunk生成、fingerprint、日英fixture  
**仕様参照**：設計§12.1〜12.3・15.6・24.3

**作業内容**：本文段落/リストを抽出し、ナビ、目次、infobox、脚注等を除外する。空白を除くUnicode code pointで数え、約200文字chunkへ分割する。大量のspanで本家DOMを書き換えず、Range参照を作る。折りたたみ本文を分母から消さない。抽出不確実・上限超過はtime_onlyへ降格する。

**完了条件**：同じ本文・抽出versionから安定したchunk定義を得られる。本文0、表中心等を無理に読了対象にしない。

**検証**：受入R09〜R11。短文/長文/長段落/数式/リスト/折りたたみ、日英、補助文字、空白をfixture化。

### W06-02：可視chunkの露出時間とDocument切替を実装する

**依存**：W06-01、W05-01  
**成果物**：coverage計測、layout invalidation、Document/session管理  
**仕様参照**：設計§9.6・12.4〜12.6

**作業内容**：50%以上可視がactive中に累計2秒という仮ルールを実装する。周辺chunkだけを測定し、scrollごとの全文走査を避ける。zoom/resize/画像読込で矩形を更新し、本文変更と装飾Mutationを分ける。アンカーは維持、本文変更・reload・プロセス喪失は新sessionにする。

**完了条件**：末尾jumpで中間chunkがcoveredにならない。検索等のNative画面に覆われている間は露出を加算しない。新Documentへ旧coverageを持ち込まない。

**検証**：受入N05、N11〜N12、R05、R07、R09、R12、R18。巨大記事でのUI負荷も計測する。

### W06-03：3状態・文字数・判定versionを実装する

**依存**：W06-01〜W06-02、W05-03、P07  
**成果物**：純粋な判定関数、記事state projection、推定文字数、server policy管理  
**仕様参照**：設計§12.7・13〜14

**作業内容**：completed→partial→viewedの順に判定する。設計v1の10秒、30秒/200文字、80%/必要時間、日英600/1000の仮値を設定から使う。Tは検証済みのaccepted時間。記事単位の自動到達状態とsession状態を分け、sessionをまたぐcoverage合成はしない。ルール変更はversion付きで扱う。

**完了条件**：境界で期待した状態になり、time_onlyから自動partial/completedを作らない。再訪で記事状態を後退させず、異なる言語を統合しない。

**検証**：受入R01〜R04、R11、R14〜R15、R18。閾値の直前/一致/直後、削除時の旧policy再計算準備。

### W06-04：手動状態修正と自動判定への復帰を実装する

**依存**：W06-03、W05-05、P08  
**成果物**：state PUT/DELETE、manual_state保存、Library/記事記録UI  
**仕様参照**：設計§13.4・14.1・17・21

**作業内容**：閲覧/途中まで/読了の手動設定と解除を実装する。manual_stateがあればeffective_stateへ優先し、自動更新で上書きしない。根拠ラベルを表示する。手動だけの記事と自動閲覧記事の件数を分け、Accountの「うち」の扱いをP08で決める。

**完了条件**：手動変更で時間・coverage・文字数・自動計測の称号根拠が増えない。解除すると保存済み自動状態へ戻る。

**検証**：受入R16〜R17、D10、D14。手動のみの読了、手動viewedへの戻し、再計測後の優先順位。

### W06-05：Androidの状態表示と読書判定を検証する

**依存**：W06-02〜W06-04、W05-04  
**成果物**：Readerの控えめな状態表示、Account更新、実機読書検証記録  
**仕様参照**：設計§6・12〜14・24〜25

**作業内容**：文字数・状態・根拠・計測不能を必要な範囲で表示する。検索やAccountから戻ったときに正しいDocumentへ復帰させる。短文/長文、静かに読む、折りたたみを開く、文字拡大等を実機で試し、過小評価を記録する。読み上げ等を正確に測定できると説明しない。

**完了条件**：3状態が理解でき、必要なら手動修正へ進める。確定していない読書速度や読了精度を実測値として表示しない。

**検証**：受入R01〜R18をAndroidで対応付け、実機確認項目とunit項目を分けて残す。

### G06：M6の完了条件

3状態、根拠表示、文字数の初期定義、手動修正が揃う。Endキー等で未表示本文が読了にならず、抽出不能時はtime_onlyになる。日英とモバイル折りたたみを含むfixture/実機の確認結果がある。

---

<a id="p12"></a>

## 12. M7：Chrome拡張への接続

**狙い：同じtrackerを本家Chromeへ載せ、Androidと別の判定実装を作らない。**

### W07-01：Manifest V3と最小popupを作る

**依存**：W00-02、W03-04、W05-05  
**成果物**：manifest、popup、options最小設定、build/package手順  
**仕様参照**：設計§10・18

**作業内容**：日英の指定URLだけへcontent scriptを入れ、API origin通信、storage、alarms等を必要最小限にする。popupに端末連携、記録停止、現在状態、未送信数、Dashboardへの導線を置く。Incognitoは初期無効。本家画面へ大きな常設UIを追加しない。

**完了条件**：不要な全サイト/history/cookies権限を要求しない。未連携・停止・対象外が分かる。

**検証**：manifest/build検査、権限レビュー、popupの未認証/認証済み/失効/対象外表示。

### W07-02：Chrome Host Adapterとタブ調停を実装する

**依存**：W07-01、W06-01〜W06-03  
**成果物**：content adapter、共通tracker bundle、短期lease、Document管理  
**仕様参照**：設計§10.2〜10.4・12

**作業内容**：isolated worldからDOMを観測し、window.mwを直接使える前提にしない。focused window内のactive tabだけへleaseを与える。hidden/blur、window変更、worker再起動、BFCacheを扱う。共通trackerへChrome APIを埋め込まず、Androidと同じfixtureを通す。

**完了条件**：複数タブで同時加算せず、worker再起動後は現状から復元する。lease切れに気付かず無期限に計測しない。

**検証**：受入R05〜R06、R09〜R13、D05。複数window、別アプリ、タブ切替、BFCache、zoomで確認。

### W07-03：workerの認証・永続キュー・同期を実装する

**依存**：W07-02、W05-03〜W05-04、W03-04  
**成果物**：IndexedDB Outbox、trusted storage、worker transport、item ACK処理  
**仕様参照**：設計§10.5〜10.6・15〜16・18

**作業内容**：sender/extension/frame/tab/URLを検証し、任意fetchを受け付けない。tokenをcontentへ渡さず、queueと秘密保管を分ける。worker停止を前提に状態を永続化し、起動・観測受信・alarm・手動操作で再送する。Androidと同じitem ACK、epoch、上限、ログアウト規則を適用する。

**完了条件**：worker停止でも保存済み記録が残り、再送は冪等。別アカウントや不正senderから記録・秘密情報へアクセスできない。

**検証**：受入D01〜D05、D08〜D10、D21〜D23。storageへのcontentアクセス、任意URL代理通信、token露出の否定テスト。

### W07-04：PC単体とAndroidとの統合を通す

**依存**：W07-01〜W07-03、W06-05  
**成果物**：Chrome実環境記録、PC/Android同一UserのE2E、差分レポート  
**仕様参照**：設計§1.3・10・24〜26

**作業内容**：日英記事を本家Chromeで読み、同じDashboardへ反映する。Androidと同じ入力fixtureなら同じ計測規則になることを確認する。DOM/host由来の差はadapterの問題として記録し、別の読了閾値で隠さない。プラットフォーム別既知制約を表示する。

**完了条件**：両端末の履歴が同じUserに集まる。実Chromeでworker停止を含む経路を確認し、unitだけで代替しない。

**検証**：受入N01〜N02、R14〜R15、D05〜D06、D08。複数端末集計の詳細境界はM8で追加検証する。

### G07：M7の完了条件

Chromeで本家UIを使った記録が残り、Androidと同じアカウントに見える。同じschema・同じtrackerを使い、各ホストの停止/復帰だけを個別実装している。worker常駐が必要な設計になっていない。

---

<a id="p13"></a>

## 13. M8：統合集計・再読・時間と文字数

**狙い：「増えたように見える」ではなく、元の記録から同じ数値を再現できる状態にする。**

### W08-01：時間unionと競合下の帰属を完成・検証する

**依存**：W05-03、W07-04、P04  
**成果物**：時間区間割当service、並行送信試験、受理順の再現規則  
**仕様参照**：設計§14.3〜14.4・19.4

**作業内容**：異なるsession/deviceの記事間重複を、受理順で決定的に割り当てる。総時間・記事別・session別の整合をP04に沿って固定する。遅延受理や同一時刻のtie-breakを定義し、同一Userの並行更新をPGで検証する。単一request内だけでなく別request/worker間で競合させる。

**完了条件**：PC60秒とAndroid60秒が30秒重なると総時間90秒。記事ごとの合計と総時間が一致し、再計算でも同じ帰属になる。

**検証**：受入D06〜D07、D03。完全重複、端点一致、包含、同記事/別記事、並列INSERT、順序逆転。

### W08-02：再読・文字数増分・期間統計を実装する

**依存**：W08-01、W06-03、P10  
**成果物**：reading_stat_increments、期間統計service、timezone設定とテスト  
**仕様参照**：設計§14.1〜14.2・17.4

**作業内容**：活動数、記事種類数、状態別件数を分ける。記事ごとのsession推定文字数最大を基礎に、期間内の増分を観測順で再計算する。遅れて届いた過去記録、日跨ぎ、timezone変更を扱う。期間活動と現在libraryの状態を応答で分け、到着日へ文字数を付け替えない。

**完了条件**：再読で活動/時間は増えるが種類数と初読相当文字数が無条件には増えない。期間合計が定義どおり一致する。

**検証**：受入R14〜R15、D20。文字数300→後日500→再読400、遅延到着、UTC/JST境界、追加timezoneでの境界。

### W08-03：再計算・隔離・policy保存を実装する

**依存**：W08-01〜W08-02、W06-03  
**成果物**：projection rebuild処理、矛盾session隔離、dry-run比較、再計算ログ  
**仕様参照**：設計§13.5・14.4・16.3・19・20.4

**作業内容**：seq順の矛盾等でsessionを隔離した場合、既に計上した寄与を取り消せるようにする。元interval・受理順・policy・文字数根拠からprojectionを再構成する。複数回rebuildしても同じ値にする。将来の削除では元policyを使う。DB transaction内と長い再計算の境界を明記する。

**完了条件**：再計算前後の期待差分を説明でき、何度実行しても増殖しない。隔離データを通常統計へ残さない。

**検証**：受入D03、D07、D19。invalid late event、手動state維持、policy更新後の旧記録、再計算中の新規eventとの競合。

### W08-04：Dashboardの履歴・統計・記事画面を仕上げる

**依存**：W08-02〜W08-03、W06-04、P08・P10  
**成果物**：Overview/Library/Activity/Article record、cursor/filter、Android Account更新  
**仕様参照**：設計§6.3・14・17・21

**作業内容**：直近活動、再読、3状態、言語別、時間、推定文字数を設計どおり表示する。cursorの安定順、期間と現在状態の違い、計測元、manual/inferred、再計算中の表示を整える。スマホの外部ブラウザで操作できるレスポンシブUIにする。

**完了条件**：活動イベント数と記事数を混同せず、説明文も定義と一致する。他Userへのcache流用がない。Androidへ複雑な全機能を持ち込まない。

**検証**：受入R14〜R17、D20、D24。大量履歴、cursor継続、フィルタ組合せ、長いタイトル、空状態。

### G08：M8の完了条件

時間・記事数・活動数・文字数・期間内増分に検証可能な定義があり、遅延・再送・並行処理・再計算でも維持される。PostgreSQLの実際のtransactionで確認し、SQLiteやmockだけの成功を根拠にしない。

---


<a id="p14"></a>

## 14. M9：プライバシー管理・削除・称号

**狙い：記録を貯めるだけでなく、止める・消す・持ち出す・公開範囲を選ぶ操作まで成立させる。**

非公開・認証・epochの土台はM3/M5で実装済みであることが前提。この工程で初めてプライバシーを追加するのではない。

### W09-01：同意・停止・端末内履歴を一貫させる

**依存**：W03-05、W05-04、W07-03、W08-04、P05  
**成果物**：`GET/PATCH /me/privacy`、同意管理、Android/拡張停止UI、制御同期  
**仕様参照**：設計§6.4・7.5・20.1〜20.3

**作業内容**：ローカル履歴保存・クラウド記録・他人への公開を別設定にする。この端末の記録停止では新しい観測と最近の記事追加を止める。既存Outboxは件数を見せ、送信/破棄を選べるようにする。全端末の受入停止はサーバーで実施し、単にボタンを隠して済ませない。

**完了条件**：停止直後に何が残り、何が送られるか分かる。片方の端末を止めても勝手に他端末の設定を変更しない。再開は同意と認証を再確認する。

**検証**：受入D08、D21〜D22、S13。追加P-PRIV-01：ローカルだけ同意/クラウドだけ停止/全端末停止の組合せ。

### W09-02：記事履歴削除・全削除と再送拒否を実装する

**依存**：W09-01、W08-03、P05・P12  
**成果物**：history削除API、history_deletion_markers、epoch更新、cache/queue無効化  
**仕様参照**：設計§15.2・16.7・20.4

**作業内容**：記事削除ではevents/sessions/intervals/manual state/文字数寄与を対象にし、古い未着sessionをmarkerと開始時刻で拒否する。全削除はUserのepochを増やす。削除とevent受理は同じUserの競合制御に入れる。端末は同期で旧queueを整理し、新しいsessionから再開する。削除markerの寿命と時刻異常の扱いを固定する。

**完了条件**：projectionだけの削除になっていない。削除前に始まったオフラインsession、遅延event、再計算から履歴が復活しない。新しい正当な読書は記録できる。

**検証**：受入D11〜D12、D07。削除直前/同時/直後の送信、閉じずに読み続ける端末、ACK紛失、複数端末offlineで検証。

### W09-03：export・アカウント削除・保持方針を実装する

**依存**：W09-02、W03-03〜W03-04、P10・P12  
**成果物**：`POST /me/export`、`DELETE /me`、保持/掃除処理、Privacy画面  
**仕様参照**：設計§17.2・18.5・20.4〜20.5

**作業内容**：本人の履歴と状態をJSONへexportし、tokenやprovider secretを含めない。アカウント削除では個人記録・identity・session・deviceを処理し、旧tokenで再送できないようにする。詳細eventを期限で削除する場合の再計算根拠を明示する。クローズド検証で保持する案と正式運用の圧縮案を混同しない。

**完了条件**：他人のexportや削除を実行できない。削除後に認証・再集計・backup手順から復活しない設計が文書化される。保持期間が未決のまま一般公開しない。

**検証**：追加P-PRIV-02：export所有者/秘密値検査、追加P-PRIV-03：account削除後の全token拒否。受入D10、D21、D24。

### W09-04：公開プロフィールの境界を実装する

**依存**：W09-01、W08-04、P09  
**成果物**：独立した公開response schema、公開設定UI、公開ページ  
**仕様参照**：設計§20.1・21.2・27

**作業内容**：非公開初期値のまま、本人が選んだ総時間・称号等だけを返せる形にする。公開pathと識別子はP09で確定して契約へ追加する。個人APIをそのまま公開ページのデータ源にしない。総時間の公開を記事履歴公開への同意とみなさず、Neighbours用の利用は初期OFFにする。

**完了条件**：非公開UserのURLを知っても記録を読めない。公開OFFや項目変更がcacheへ反映される。MVP-Bの投稿を自動生成しない。

**検証**：受入D13〜D14、D24。匿名/本人/他User、公開切替、cache失効、HTML/JSONの不要fieldを確認。

### W09-05：固定称号と管理導線を仕上げる

**依存**：W09-02〜W09-04、W08-04、P07  
**成果物**：`GET /me/achievements`、固定rule、Dashboard称号、Account管理導線  
**仕様参照**：設計§6・14.5・20〜21

**作業内容**：記事種類数・時間・日英の読書活動など、設計の3系列程度を派生表示として実装する。手動stateだけを根拠にしない。履歴削除やsession隔離で再評価する。Androidは詳細管理をDashboardへ委譲し、停止・状態修正・削除に到達できる入口を残す。

**完了条件**：称号の条件と根拠指標が一致する。削除後に条件を満たさなくなれば表示が更新される。任意のジャンルや架空の上位%は作らない。

**検証**：受入R16、D11〜D14。境界値、再読、日英各1件、削除/隔離後、公開許可との組合せ。

### G09：M9の完了条件

記録停止、端末解除、記事削除、全削除、アカウント削除、export、最小の公開範囲管理を利用できる。旧キュー・再計算・公開cacheから削除/非公開情報が復活しない。称号は現在の有効な根拠に一致する。

---

<a id="p15"></a>

## 15. M10：統合検証・配布準備

**狙い：単体機能の集合を、実際に使えるMVP-Aとして判定する。**

### W10-01：全受入ケースと脅威境界を通し直す

**依存**：M1〜M9の成果物  
**成果物**：受入台帳、最終commitのCI結果、E2E/security検証記録  
**仕様参照**：設計§24・26.3

**作業内容**：設計の受入N01〜N14、S01〜S14、R01〜R18、D01〜D24をすべて対応付ける。Android実機・Chrome実環境・PG並行処理・OAuth実認証の未確認を洗い出す。後述の追加ケースも実施する。修正後は影響範囲だけでなく、リリース対象commitの必須suiteを再実行する。

**完了条件**：各項目に結果・証跡・対象commit・環境がある。重大な情報漏洩、二重計上、削除復活、検索/戻るの破綻が残っていない。

**検証**：原設計の70ケースと本書追加ケース。skipは理由と代替/未対応範囲を明記し、passに含めない。

### W10-02：実機UX・性能・利用継続の仮説を検証する

**依存**：W10-01の機能基準  
**成果物**：実機マトリクス、検索UIの確認画像、負荷測定、自己利用メモ  
**仕様参照**：設計§7・12・25・26

**作業内容**：検索の使いやすさ、Readerのscroll負荷、電池/バックグラウンド挙動、未送信の分かりやすさを確認する。設計のcache-hit API p95 500ms目標等は環境と件数を明示して測定する。長く静かに読む場合の過小評価や分割読書も評価し、閾値変更はpolicy更新にする。自己利用期間は設計案の一週間程度を候補とし、日程保証にはしない。

**完了条件**：計測が読書を邪魔しない。分かった制限と改善点が記録され、精度・性能に根拠のない保証がない。

**検証**：受入N11〜N12、S03・S11、R08〜R11。高文字サイズ、dark mode、遅い回線、長文、複数端末を含める。

### W10-03：デプロイ・migration・backup/復元を整える

**依存**：W10-01、P11・P12  
**成果物**：検証環境、設定/秘密管理、運用runbook、migration/復元記録  
**仕様参照**：設計§19・20.5・23.6・25

**作業内容**：選んだ配備先でHTTPS、DB永続化、設定注入、migration実行、失敗時の停止、backupを確認する。削除後の古いbackupを戻すときに、削除・失効・epochの記録を適用する手順を決める。再計算コマンドとtoken漏洩時の失効導線を用意する。特定クラウドの無料枠を前提にしない。

**完了条件**：空環境構築とbackup復元を別々に再現できる。DB復元後も削除済み履歴/旧tokenを無条件に復活させない。破壊的migrationを自動downgradeできると決めつけない。

**検証**：受入D19、D11〜D12。追加P-OPS-01：復元後の削除・認証・再計算、追加P-OPS-02：migration失敗からの復旧。

### W10-04：Androidと拡張の配布物・説明を準備する

**依存**：W10-01〜W10-03、P11  
**成果物**：version付きAPK/拡張package、署名管理手順、release notes、Privacy説明  
**仕様参照**：設計§9.5・10・23.5〜23.6・30

**作業内容**：application IDと署名鍵の管理を固定し、debug/配布設定を分ける。閉じたAPK/拡張検証、Store公開等は選んだ方式に応じて最新の要件を確認する。API接続先、OAuth設定、拡張権限、非公式サービスの説明、Wikimedia表示・ライセンス導線を点検する。署名鍵や秘密設定を配布物/文書へ含めない。

**完了条件**：配布物がどのcommit/schema/trackerに対応するか分かる。インストール・更新・再連携・アンインストールの説明がある。未申請・未審査を公開済みと扱わない。

**検証**：実機インストール/更新、既存Room/設定移行、拡張再読込/更新、release buildの秘密値/デバッグ確認。

### W10-05：MVP-Aを判定し、後続バックログへ引き継ぐ

**依存**：W10-01〜W10-04  
**成果物**：`docs/releases/`の判定記録、既知制約、次段階の優先候補  
**仕様参照**：設計§1.3・3・24.4・26〜29

**作業内容**：ユーザーの縦断シナリオと各ゲートを照合する。残件はリリース阻止/制限明示/後続へ分類し、未完を完了と書かない。MVP-BやNeighbours/Raceは別マイルストーンとして残す。実装中に得た工数・障害傾向から次工程の見積もりを更新する。

**完了条件**：MVP-A完了または未完の理由が一つの記録で説明できる。Androidだけの完成を全体完了にしない。

**検証**：G00〜G10、要件トレース、最終commit、配布artifact対応のレビュー。

### G10：MVP-Aのリリースゲート

| 分類 | 必須条件 |
|---|---|
| 体験 | Android検索→閲覧→記録、Chrome閲覧→同じUser→Dashboardが通る |
| 認証 | Google/GitHub、identity追加、端末解除、scope、ユーザー分離を確認 |
| 計測 | 日英、3状態、time_only、手動修正、本文/時間の限界を表示 |
| 整合性 | 再送・並行送信・逆順・日跨ぎ・再計算が期待値に一致 |
| プライバシー | 非公開、停止、削除、旧queue拒否、export、公開cacheの分離 |
| 実環境 | Android実機・Chrome・PostgreSQL・OAuth実認証の証跡 |
| 運用 | 配布方式、HTTPS、migration、backup/復元、秘密管理、保持方針 |
| 記録 | 対象commit・build・既知制約・未実行項目が明示されている |

一般公開するか、閉じた検証として使い始めるかはP13で決める。閉じた検証でも、ユーザー間の漏洩・通常の再送による削除復活などを許容してよい意味ではない。

---


<a id="p16"></a>

## 16. API・DB・共有コードの実装対応表

**根拠：設計§5・15〜19・23。実装先と工程の対応は本書の追加提案。**

### 16.1 APIの実装担当

以下のpathは特記がなければ`/api/v1`以下。詳細設計書のpath案を引き継ぎ、変更は契約変更として扱う。

| API | 作業 | 最初に固定する内容 |
|---|---|---|
| `GET /auth/{provider}/start`、`GET /auth/{provider}/callback`、`POST /auth/logout` | W03-01〜W03-02 | 許可provider、Web session、callback検証、エラー |
| `POST /device-links`、`POST /device-links/{id}/approve`、`POST /device-links/{id}/exchange` | W03-04 | grant/秘密値/承認/一回交換、期限、試行制限 |
| `GET /me` | W03-01・W03-05 | 内部User、表示名、認証状態、端末から読む範囲 |
| `GET /me/identities`、`POST /me/identities/{provider}/link`、`DELETE /me/identities/{provider}` | W03-03 | 本人による追加、他Userとの競合、最後の手段の保護 |
| `GET /me/devices`、`DELETE /me/devices/{device_id}` | W03-04〜W03-05 | 所有者、scope、失効 |
| `POST /articles/resolve`、`GET /articles/{article_id}` | W04-03 | 正規記事、識別入力、missing/stale |
| `GET /wikis/{wiki}/pages/{page_id}`、`POST /articles/batch-get` | W04-03 | 逆引き、未登録補充、取得上限、ユーザー情報を含めない |
| `POST /reading-events/batch` | W05-03 | schema/認証/epoch/冪等性/区間/ACK |
| `GET /me/activities`、`GET /me/articles`、`GET /me/articles/{article_id}` | W05-05→W08-04 | session履歴と記事状態の分離、cursor、scope |
| `PUT /me/articles/{article_id}/state`、`DELETE /me/articles/{article_id}/state` | W06-04 | 手動override、自動へ復帰、時間と文字数は変更しない |
| `GET /me/stats` | W05-05→W08-02 | time_onlyから開始し、library/activityと期間の意味を固定 |
| `GET /me/achievements` | W09-05 | 自動計測の根拠から固定ruleで算出 |
| `GET/PATCH /me/privacy` | W09-01 | 同意・公開・受入停止の権限とscope |
| `DELETE /me/articles/{article_id}/history`、`DELETE /me/history` | W09-02 | marker、epoch、再計算、端末への反映 |
| `POST /me/export`、`DELETE /me` | W09-03 | 認証強度、本人データの範囲、秘密除外、全token失効 |
| 公開プロフィールAPI：path未定 | P09→W09-04 | 個人APIと別schema、公開項目、cache |
| 記録制御の取得/通知：契約未定 | P05→W05-03・W09-01〜W09-02 | epoch、削除marker、同意/停止、古いqueueの扱い |

`/posts`、`/feed`、通報等はMVP-Bで追加する。未実装endpointのダミー成功応答を、稼働機能として公開しない。

### 16.2 schemaを変える手順

```text
詳細設計/ADRに変更理由
  → Pydanticモデル
  → JSON Schema / OpenAPI生成
  → TS / Kotlinの型・モデル生成
  → valid/invalid fixture更新
  → Python・TS・Kotlinの契約テスト
  → Android/Chromeの保存済みqueue互換性を確認
  → API・クライアントの配布順を決定
```

最初の内部開発ではschema v1を調整してよいが、配布済みクライアントが存在した後の破壊的変更は黙って行わない。対応するclient/schema version、移行、非対応時のメッセージを残す。

本計画の追加提案として、配布物に`schema_version`、`client_version`、`extractor_version`、`measurement_policy_version`、trackerのbuild識別を対応付けたmanifestを残す。tracker識別を必ずAPIフィールドへ増やすという指定ではない。

### 16.3 DB migrationの順序

| 工程 | 主なtable/変更 | 同時に必要な検証 |
|---|---|---|
| M0 | engine/session/Alembic基盤 | 空DB、UTC/UUID、rollback |
| M3 | users、auth_identities、web_sessions、devices、device_link_requests、user_privacy_settings | provider一意、scope、失効、非公開初期値、epoch |
| M4 | articles、必要なarticle_aliases | `(wiki,page_id)`一意、同時解決、missing |
| M5 | reading_sessions、reading_events、reading_intervals | 複合一意、User/device所属、immutable payload、並行受理 |
| M6 | article_reading_statesとmanual/inferred、policy保存 | 手動と自動の分離、旧policy |
| M8 | reading_stat_increments、集計用index/必要なprojection | 遅延到着、期間割当、rebuild |
| M9 | history_deletion_markers、公開/保持に必要な追加 | 削除競合、epoch、marker期限、秘密除外 |
| MVP-B | posts、post_reports | 投稿と読書domainの分離 |

tableやindexをまとめる場合も、責務と一意制約を維持する。フルschemaをM0で先に作り、不要な後続機能を本番の必須依存にしない。

各migrationには前提version・適用手順・データ変換・戻し方または復元方針を記す。DBへ適用していないmigrationファイルの存在だけで「移行確認済み」にしない。

### 16.4 共有コードと端末固有コード

| 共有 | Android固有 | Chrome固有 |
|---|---|---|
| DOM adapter、chunk、可視率、active time候補、Document、schema | WebView lifecycle、Native overlay、origin bridge、Room、token保護、WorkManager | tab/window lease、sender検証、worker、IndexedDB、trusted storage、alarm |
| 判定に必要な観測値の定義 | Native検索UI、日英の検索先 | popup、manifest、権限 |
| fixtureとcontract tests | 実機のIME/lock/renderer試験 | 実ChromeのBFCache/worker試験 |

最終読書状態、accepted時間、公開範囲、称号はBackendで決める。AndroidへKotlin版の別読了アルゴリズムを作らず、Chrome向けにも別の閾値を増やさない。

---

<a id="p17"></a>

## 17. テストケース・検証データ・品質ゲート

**根拠：設計§24の70受入ケース。具体的なfixtureと追加のケースIDは本書の計画追加。**

### 17.1 元の受入ケースの配置

| 元のID | 件数 | 主に確認する工程 | 最終確認 |
|---|---:|---|---|
| N01〜N14：Reader/Navigation | 14 | M1、M5、M6 | M10 |
| S01〜S14：Search | 14 | M2 | M10 |
| R01〜R18：Tracking/状態 | 18 | M5〜M8 | M10 |
| D01〜D24：同期/DB/Privacy | 24 | M3〜M9 | M10 |
| 合計 | 70 | 機能ごとの実装と同時 | 最終commitで再確認 |

設計§24の各行を、テスト台帳の独立した行へ移す。上の範囲を「まとめて確認済み」と一行で済ませない。D14はMVP-Aでフィードが未実装でも、「手動状態変更が公開副作用を発生させない」境界を確認する。

### 17.2 具体的な計算fixture

すべて合成データであり、人間の読書速度の実測ではない。P04の時間帰属を確定した後、その規則に合わせて期待値を固定する。

| ID | 入力 | 期待結果 |
|---|---|---|
| F01 | time_only、accepted 9,999ms | 自動の閲覧状態は未成立 |
| F02 | time_only、accepted 10,000ms | viewed。partial/completedにはしない |
| F03 | 日本語N=3,000、C=200、T=30秒 | partial |
| F04 | 日本語N=3,000、C=2,400、T=239.999秒 | completed未達 |
| F05 | 日本語N=3,000、C=2,400、T=240秒 | completed、session推定文字数2,400 |
| F06 | 英語N=3,000、C=2,400、T=144秒 | v1係数1,000でcompleted、推定2,400 |
| F07 | N=300、C=240、T=30秒 | 日本語/英語とも初期completed条件を満たす |
| F08 | 本文抽出失敗、T=1時間 | viewed/time_only。自動読了・文字数を作らない |
| F09 | PC[0,60秒)、Android[30,90秒) | 総時間90秒。PCを先に受理した例ならPC60秒・Android30秒 |
| F10 | [0,10秒)と[10,20秒) | 半開区間として重複0、総時間20秒 |
| F11 | 6区間の累積60秒snapshotだが受理済みintervalは10秒分だけ | 10秒だけ計上。残り50秒を推測して補完しない |
| F12 | 同じevent_id/payloadを10回送信 | acceptedは一度分、残りduplicate、時間不変 |
| F13 | 同じevent_idでpayloadを変更 | conflict。再送扱いで上書きしない |
| F14 | 同記事のsession最大値：初日300、翌日500、翌々日400 | 生涯最大500、日別増分300/200/0 |
| F15 | F14の初日300が後から届く | 観測順に再計算し、到着日に300を付けない |
| F16 | 同記事を別sessionで前半50%・後半50% | coveredを合成せず、両sessionが未読了なら自動読了にしない |
| F17 | 手動completed、計測eventなし | 手動読了は表示可能、自動閲覧数・時間・文字数は増えない |
| F18 | JST 23:59:50〜翌00:00:10の20秒active | 日別10秒/10秒、総時間20秒 |
| F19 | epoch=1で作ったqueueを全削除後epoch=2へ送信 | 拒否。Userの履歴は復活しない |
| F20 | 記事削除前に開始したsessionのeventが削除後に届く | marker規則に従い拒否。新sessionの正当な読書は別に受理 |
| F21 | seq順に見て累積値が矛盾するeventを遅延受理 | session隔離と既計上寄与の再評価。黙って最大値だけ採用しない |
| F22 | 本文0またはchunk総文字数とtext_chars不一致 | 0文字読了を作らず、schema/意味検証で拒否またはtime_onlyへ適切に分離 |

F09の**記事・sessionへの帰属は受理順に依存し得る**。再計算時は保存した受理順を再現する。送信順を変更した別実験まで記事別配分が同じになると要求しない。一方、同じ有効区間集合の総union時間は一致させる。

### 17.3 検索・DOMのfixtureセット

| 分類 | 用意するデータ |
|---|---|
| 検索正常 | 日英各種、候補10件、本文20件、説明なし、長いタイトル |
| 検索異常 | 0件、429、5xx、timeout、壊れたJSON、HTML抜粋、応答逆転 |
| IME | 未確定→確定、確定後すぐ削除、Enterと候補取得の競合、言語変更 |
| DOM | 短文、長文、画面より長い段落、リスト、表、数式、脚注、infobox |
| モバイル | 折りたたみ未展開/展開、画像読込後の移動、文字サイズ、zoom |
| 対象外 | 検索、カテゴリ、差分、oldid、特殊ページ、メインページ、曖昧さ回避 |
| 変化 | 装飾Mutationのみ、本文変更、reload、アンカー、BFCache復帰 |
| URL | ja/en通常、curid、redirect、不正encoding、userinfo、非標準port、偽host |

実在HTMLを保存する場合、出典URL・取得日・revisionが分かる範囲・ライセンスをfixture metadataへ残す。テスト用に簡略化したDOMは合成fixtureと表示し、本家実サイト全体での保証にしない。

### 17.4 追加の境界テスト

| ID | 内容 | 工程 |
|---|---|---|
| P-CONTRACT-01 | 同一fixtureをPython/TS/Kotlinで検証し、null/整数/未知field/union分岐が一致 | M0・M5 |
| P-CONTRACT-02 | 配布後schema変更、保存済みOutbox、tracker更新時のDocument切替 | M6・M10 |
| P-WEBVIEW-01 | 許可外origin/iframeからbridgeへ送信、偽session、過大payload | M1・M5 |
| P-WEBVIEW-02 | 安全なbridge非対応でもReaderは利用可能、計測成功を装わない | M1・M10 |
| P-AUTH-01 | grantの盗用/再使用/期限/承認CSRF/短いコード単独の交換 | M3 |
| P-PRIV-01 | ローカル保存同意・クラウド同意・端末停止・全端末停止を独立に検証 | M2・M9 |
| P-PRIV-02 | JSON exportの所有者検査と秘密情報除外 | M9 |
| P-PRIV-03 | アカウント削除後に全Web session/device tokenで拒否 | M9 |
| P-AGG-01 | session隔離後の時間再割当と手動state維持 | M8 |
| P-AGG-02 | 削除後のrebuild、繰り返しrebuild、同時event受理での整合 | M8〜M9 |
| P-OPS-01 | backup復元後に削除・失効情報を再適用し、旧queueを拒否 | M10 |
| P-OPS-02 | migration失敗・途中停止時の復旧、未commitを成功扱いしない | M10 |
| P-UI-01 | 手動だけで読了にした記事が、Accountの「うち」の内訳を壊さない | M6・M8 |
| P-UI-02 | zero inputの履歴消去/停止直後に、cacheや画面復帰で再表示されない | M2・M9 |

### 17.5 証跡の形式

実装時は例えば次の形で記録する。以下は空のテンプレートであり、検証実績ではない。

```markdown
# Mxx 検証記録

- 対象commit:
- 設計version / schema_version:
- APK・拡張・trackerのbuild:
- 実行日時:
- 実行者:
- Android機種 / OS / WebView:
- Chrome / PostgreSQL / API環境:
- 使用fixture:
- 実行コマンド:

| ケースID | 結果 | 証跡 | 備考・残件 |
|---|---|---|---|
| N01 | 未実行 | | |

## 手動検証
操作、期待値、実際の結果、画面またはログを記録する。

## 制約
未実行・skip・失敗を明記する。

## 再検証
修正commitと再実行した範囲を記録する。
```

結果は`pass / fail / skipped / not_run / blocked`を区別する。画面画像やログに本人以外の読書履歴・token・OAuthコードを含めない。

### 17.6 不具合のリリース判断

| 分類 | 例 | 扱い |
|---|---|---|
| リリース阻止 | 別Userへの漏洩、secret露出、削除復活、恒常的二重計上、安全でないbridge、Google/GitHub片方未対応、日英片方未対応 | 解消までMVP-A完成にしない |
| 中核体験の阻害 | 検索/戻るが通常操作で壊れる、保存済みqueue消失、常時停止する計測 | 原則として解消する |
| 制限を明示できる項目 | 対象外の本文形式でtime_only、静かな読書の過小評価、確認済みの安全な計測非対応環境 | 設計どおりのfallbackと説明があれば残せる |
| 後続でよい項目 | アニメーション、画像付き候補、推薦、iOS、Neighboursの高度化 | MVPを止めない |

---

<a id="p18"></a>

## 18. 開発運用・PR・実装エージェントへの渡し方

**この章は本書で追加した開発運用案。現在その運用が導入済みという意味ではない。**

### 18.1 作業状態

```text
unassessed：既存コードとの対応を未確認
  → ready：仕様・依存・受入条件が明確
  → in_progress
  → review
  → verified：受入証跡あり
  → done：文書・migration・配布影響も反映済み
```

外部設定・環境・意思決定待ちは`blocked`とし、理由と解除条件を残す。実装は存在するが試していない状態をdoneにしない。

### 18.2 一人で進める場合の推奨順

M0→M1→M2の順で、まず自分がAndroidで読めるものを作る。その後M3とM4を整え、M5の縦断を通す。M6の計測を作ってからM7のChromeへ広げると、共通trackerを検証しながら進められる。

M8以降は新しい画面を増やすより、既存の数字・削除・再送を信頼できる状態にする。M10まで到達する前にMVP-Bやゲームへ寄り道しない。

### 18.3 並行開発できる境界

| 並行化 | 前提 |
|---|---|
| Android Reader/SearchとWeb認証 | 共通User/device/Article契約の枠がある |
| MediaWikiClientと認証adapter | 独立fixtureとI/O境界がある |
| DOM fixtureとBackend判定関数 | 文字数/chunk/time定義を共有している |
| Chrome popupとAndroid計測 | device APIと同期状態の契約がある |
| UI仕上げと集計負荷検証 | response schemaを凍結している |

同じschema、migration head、読書判定を複数のエージェントが独立に変更しない。契約変更は一つの担当PRへ寄せる。競合を避けるために、M0で機能ごとの所有範囲を決める。

### 18.4 PRの切り方

望ましい分割は「小さな縦断」または「責務が閉じる変更」である。例えばW05-03は、schema/DB制約、domain受付、HTTP/ACK、並行試験の複数PRに分けてよい。ただし、未認証の暫定APIを公開環境へ出さない。

各PRの共通完了条件：

- [ ] 対象WBS ID、設計章、変更範囲が明記されている。
- [ ] 正常系だけでなく失敗・再送・他Userの否定テストがある。
- [ ] schema生成、migration、設定例の更新を伴っている。
- [ ] テストの実行結果と未実行の範囲が書かれている。
- [ ] 秘密値・本文・入力語を不要にログへ出していない。
- [ ] 設計変更があればADRと詳細設計書も更新している。
- [ ] 「一時的な簡略化」が残る場合、解除条件と後続taskがある。

### 18.5 開発コマンドの契約

以下は**M0で用意するコマンド名の例**であり、現在のリポジトリに存在する、または本書作成で実行したという意味ではない。実際の名前はREADMEへ固定する。

```text
make bootstrap
make dev
make schema-generate
make schema-check
make test-python
make test-postgres
make test-tracker
make test-contracts
make test-web
make build-android
make test-android
make build-extension
make test-e2e
```

`test-android`の成功が実機のWebView検証を全て含むかは別に説明する。実サイト/実認証のsmoke testは、通常のoffline CIとは明確に分ける。

### 18.6 コーディングエージェントへの依頼テンプレート

```markdown
# 作業
Wxx-yy：タスク名

# 基準
- docs/design/wikimf-detailed-design-v0.1.md
- docs/implementation/wikimf-implementation-plan-v0.1.md
- 関連ADR:
- 対象commit/branch:

# 実装すること
このタスクの作業内容と成果物を転記する。

# 変更しないこと
- wikimfの名前、日英、3状態、共通イベント、記事ID
- Google/GitHub、非公開初期値
- 冪等性、永続Outbox、token分離
- 他の未承認タスクのスコープ

# 完了条件
対象の受入IDと期待結果を転記する。

# 検証
必要なunit/integration/実機テストを指定する。
実行不能なら理由と未確認範囲を報告する。

# 最終報告
- 変更したファイルと責務
- 実装したAPI/schema/migration
- 実行したテストと対象commit
- 未実行・既知制約
- 設計判断が必要になった点
- 残件と次のWBS ID
```

仕様のない点に直面したら、確定事項を変えず、局所的な仮案をADRへ残す。新しいフレームワーク、SNS全体、ゲームエンジンを独断で追加しない。外部設定がない場合はfakeと実接続を区別して報告する。

---

<a id="p19"></a>

## 19. リスク・計画変更・後続機能

### 19.1 主要リスクと対処

| リスク | 早期に分かる兆候 | 対処 | 該当作業 |
|---|---|---|---|
| WebView機能の環境差 | 安全なbridge/注入が利用不可 | M0で確認、Readerのみへの降格、対応範囲を明示 | W00-06・W01-04 |
| 本家DOMの差・変更 | 抽出失敗率、折りたたみ分母の不整合 | version付きadapter、fixture、time_only | W06-01〜W06-05 |
| 検索の使いづらさ | IME中の連打、古い結果の上書き | state/世代管理、実機UX確認 | W02-02・W02-04 |
| 認証設定待ち | 実callback/実providerが未確認 | fakeで局所開発し、実認証ゲートは未完とする | W03-02〜W03-05 |
| 同期による数値ずれ | duplicate/逆順/同時送信で増える | immutable event、一意制約、transaction、interval | W05-02〜W05-04・W08-01 |
| 削除した記録の復活 | offline端末やrebuildで再出現 | epoch/marker、制御同期、backup復元手順 | W09-02・W10-03 |
| 個人情報の漏洩 | 公開schemaやcacheに履歴が混入 | 個人/公開schema分離、所有者検査、log最小化 | W03-01・W09-04 |
| 計測が重い | scrollの引っ掛かり、電池負担 | 周辺chunk測定、間引き、常時実行前提を避ける | W06-02・W10-02 |
| 保持データの肥大 | event/intervalの増加 | 公開前に保持・圧縮・再計算根拠を決定 | P12・W09-03 |
| スコープの拡大 | ゲーム/Neighboursが先に進む | MVP-Aゲートと後続backlogを分離 | W10-05 |

### 19.2 予定より重くなった場合の削り方

優先して削れるのは装飾、候補画像、高度なグラフ、細かなアニメーション、複雑な汎用抽象化、後続ソーシャルである。Android側にDashboard全機能を複製しない。

**削らないもの**は、日英、検索の両mode、Google/GitHub、3状態、ID逆引き、再送の整合性、非公開、停止・削除、ユーザー分離である。これらを変更する必要がある場合は「MVPを簡略化した」と黙って進めず、方針変更として扱う。

記事形式の一部をtime_onlyにする、未対応WebViewをReader-onlyにするなど、詳細設計が既に定めたfallbackは利用してよい。ただし全件fallbackのまま本文計測が完成したとはしない。

### 19.3 MVP-Aの後続

| 段階 | 入口条件 | 最小の次の成果 |
|---|---|---|
| MVP-B：最小ソーシャル | MVP-Aの記録・削除が信頼できる | 記事+一言、時系列feed、削除、通報/運営 |
| Wikipedia Neighbours | 対象データ・公開同意・必要な記録がある | 公開許可済みの情報だけで共通点や記事発見を試す |
| Wiki Race | 記録domainと分離できる | 既存資産を再確認し、検証済みのお題を一つ遊べる |
| Xログイン | Google/GitHubが完成 | 最新の提供条件を確認してproviderを追加 |
| iOS/他ブラウザ | 追加する利用上の理由がある | 共通trackerを新Host Adapterへ接続 |

後続は詳細設計§27の方向性を維持する。類似度計算やゲーム形式をこの計画で新たに確定しない。非公開履歴から相手の人物像を当てさせる出題にしない。

---

<a id="p20"></a>

## 20. 要件トレース・着手チェック・参照

### 20.1 ユーザー要件から実装への対応

| 要件 | 詳細設計 | 本書の主な作業 | 確認先 |
|---|---|---|---|
| `wikimf` / Last.fm for Wikipedia | §1・2・28 | W00-01、W10-05 | G00・G10 |
| PC/Android/Web | §2・5 | M1・M3・M7・M8 | G07・G10 |
| 本家WikipediaのWebView | §6・8・9 | W01-01〜W01-04 | 受入N01〜N14 |
| 日本語・英語 | §7・8・11 | M1・M2・M4・M6 | 受入N01〜N02、R15 |
| 戻る・進む・検索・メニュー | §6・8 | W01-01〜W01-03 | 受入N03〜N12 |
| 候補検索と本文検索 | §7 | W02-01〜W02-04 | 受入S01〜S14 |
| 検索画面の言語選択 | §7.4 | W02-02・W02-04 | 受入S08・S14 |
| 最近見た/最近検索した記事 | §7.5・20 | W02-03、W09-01 | 受入S01・S05〜S07・S13 |
| Accountは小さくDashboardへ | §6.3・21 | W03-05・W05-05・W08-04・W09-05 | G05・G09 |
| 閲覧・途中まで・読了 | §13・14 | W06-03〜W06-05 | 受入R01〜R04・R16〜R18 |
| イベント形式の統一 | §5・15・16 | W00-03・M5・M7 | P-CONTRACT-01、受入D01〜D10 |
| 記事ID・逆引きAPI | §11・17 | W04-01〜W04-04 | 受入D09・D18 |
| Google/GitHubと内部User ID | §18 | W03-01〜W03-05 | 受入D08・D10・D15〜D17 |
| PostgreSQL・DB変更余地 | §19 | W00-04・W08-01・W10-03 | 受入D07・D19 |
| 非公開・停止・削除 | §20 | W03-01・M9・W10-03 | 受入D11〜D14・D21・D24 |
| Neighbours・ミニゲーム | §22・27 | 本書§19.3の後続 | MVP-Aの必須から分離 |
| Xは低優先 | §18.7・29 | 本書§19.3の後続 | 未実装UIを出さない |

### 20.2 実装着手チェック

- [ ] 基準設計v0.1と本計画を作業リポジトリへ保存する。
- [ ] 対象リポジトリ・commitを確認し、既存実装と52タスクを照合する。
- [ ] P01/P02を決め、P03〜P13の判断期限を登録する。
- [ ] 最初の作業をW00-01〜W00-06に限定してIssue化する。
- [ ] 個人情報を含まないfixtureとPostgreSQL統合テスト環境を用意する。
- [ ] Androidの実機とChromeの検証環境を記録する。
- [ ] OAuth設定と配布識別子が必要な工程を把握する。
- [ ] 冪等性・秘密分離・削除世代を、PoCの理由で後から消さない。

### 20.3 本書と基準仕様の更新

詳細設計書のrevisionが変わったら、WBS・受入・契約への影響を比較し、両文書のversionを更新する。仕様変更と実装の完了状態を同じ欄に混在させない。

本計画の52作業は実装範囲の分解であり、52PR・52日・52件の作業済みIssueを意味しない。日程と実際のPR数は実装実績と体制に合わせて見積もる。

### 20.4 参照と検証範囲

本書の直接の基準は次の文書である。

- [wikimf 詳細設計書 v0.1](wikimf-detailed-design-v0.1.md)
- 特に[段階的な実装計画](wikimf-detailed-design-v0.1.md#s26)、[テスト計画と受入条件](wikimf-detailed-design-v0.1.md#s24)、[未決事項・要件トレース](wikimf-detailed-design-v0.1.md#s29)。

旧`wikipedia-sns-mvp-design.md`やWikipedia_Raceの調査結果については、基準設計§22・30に書かれた範囲を引き継ぐ。本書では既存リポジトリを再取得していないため、そこに現在何が実装されているか、過去の指摘が修正済みかは断定しない。

外部の技術仕様・利用条件・料金・審査要件の最新確認は、本書では行っていない。必要な工程で公式資料と採用versionを確認し、その検証を記録する。

**本書作成で実施したこと**：基準設計書の読解、工程/タスク/依存/受入への分解、計画Markdownの作成と文書構造の確認。  
**本書作成で実施していないこと**：リポジトリへの変更、Issue登録、アプリ/Backend実装、API疎通、OAuth実認証、実機試験、DB試験、デプロイ、Store申請。

---

**実装の中心線：Androidで読める → 検索できる → 同意して時間を記録できる → 3状態に分かれる → PCと統合できる → 安全に振り返り・修正・削除できる。**
