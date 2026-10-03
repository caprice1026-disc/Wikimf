# MVP-A受入台帳

更新日: 2026-10-04。対象は[詳細設計§24.2](../wikimf-detailed-design-v0.1.md)の70ケースと[実装計画](../wikimf-implementation-plan-v0.1.md)のG00～G10。実装、実行済みの証跡、未実施のシステムテスト（ST）を区別する。最終の対象SHA、配布物のhash、必須suiteの再実行結果はリリース記録で固定する。この台帳だけをリリース完了の宣言に用いない。後日の実環境受入は[追跡Issue #13](https://github.com/caprice1026-disc/Wikimf/issues/13)へ引き継ぐ。

「確認」は記載した層で期待値を確認した意味であり、端末・provider・配布環境をまたぐ全経路の合格ではない。「一部」は実装または下位層の確認まで。「ST」は実環境で未実施。「再検証中」は修正後の最終結果待ち。未実施を合格件数へ含めない。ST-IDの操作・前提・保存する証跡は[ST計画](ST-plan.md)に記す。

## 実装と証跡の索引

| ID | 実装または実行証跡 | 確認した境界・制約 |
|---|---|---|
| A | [MainActivity.kt](../../apps/android/app/src/main/java/org/wikimf/reader/MainActivity.kt)、[UrlPolicy.kt](../../apps/android/app/src/main/java/org/wikimf/reader/UrlPolicy.kt)、[BridgeGuard.kt](../../apps/android/app/src/main/java/org/wikimf/reader/BridgeGuard.kt) | Compose Reader/Search/Account、WebView遷移・focus・lifecycle、origin/main-frame/native session検査。 |
| AS | [Api.kt](../../apps/android/app/src/main/java/org/wikimf/reader/Api.kt)、[Storage.kt](../../apps/android/app/src/main/java/org/wikimf/reader/Storage.kt) | 日英検索、キャンセル/世代、owner別履歴、SQLite Outbox、Keystore保存、ACK・control取得。Room案は同じ耐久契約をSQLite transactionで実装。 |
| A1 | [BoundaryTest.kt](../../apps/android/app/src/test/java/org/wikimf/reader/BoundaryTest.kt)、[DashboardUrlsTest.kt](../../apps/android/app/src/test/java/org/wikimf/reader/DashboardUrlsTest.kt)、[SearchCooldownTest.kt](../../apps/android/app/src/test/java/org/wikimf/reader/SearchCooldownTest.kt)、`apps/android/app/build/test-results/testDebugUnitTest/` | JVM 10件、failure/error/skip 0。URL、main frame/owner、検索応答逆転、session/seq/interval、管理画面origin/route、debug emulator変換、承認URLのgrant束縛、Retry-After秒値/date/不正値/overflow、wiki別期限・再open・世代検査。画面操作の証跡ではない。 |
| A2 | [PersistenceTest.kt](../../apps/android/app/src/androidTest/java/org/wikimf/reader/PersistenceTest.kt)、[test-device.ps1](../../apps/android/test-device.ps1)、[persistence.txt](../../apps/android/verification/persistence.txt) | Android 15/API 35エミュレータのSQLite再open・payload不変・owner分離・epoch・履歴削除とKeystoreの2件、OK(2 tests)。UTPの結果収集失敗は合格証跡に使わず、実adb instrumentation出力を使う。 |
| A3 | [ReaderFocusRegressionTest.kt](../../apps/android/app/src/androidTest/java/org/wikimf/reader/ReaderFocusRegressionTest.kt)、[native-smoke.txt](../../apps/android/verification/native-smoke.txt)、[native-final-suite.txt](../../apps/android/verification/native-final-suite.txt)、[native-e2e.json](../../apps/android/verification/native-e2e.json) | focus単独26.046秒、OK(1 test)。その後の最終debug APKでは明示Native suite全4件が28.407秒で成功。API35/WebView124.0.6367.219で実Earth DOM→実API/PGの縦断例4session（viewed2/partial2、active最大120,629ms、quarantine=false）。Accountで12秒待ってactive44,980ms→44,980ms。identity/metadataは合成。通常実行のskipは合格に含めない。 |
| A4 | [offline-observation.json](../../apps/android/verification/offline-observation.json)、[lifecycle-observations.json](../../apps/android/verification/lifecycle-observations.json)、[lifecycle-summary.json](../../apps/android/verification/lifecycle-summary.json)、[background-pause.json](../../apps/android/verification/background-pause.json)、[Android検証記録](../../apps/android/VERIFICATION.md) | 同じdebug APK/API35エミュレータで実操作、lifecycle summaryの8条件がtrue。offline queue2件→online後0、accepted累計81,821ms、quarantine=false。Search往復でEarth URL/scrollY1800/history/session維持、fragment同session、native前後移動、回転後Moon位置/履歴維持を確認。回転ごとにsession再作成を観測。Home後12秒のactive34,989ms→34,989ms。 |
| A5 | [DashboardUrls.kt](../../apps/android/app/src/main/java/org/wikimf/reader/DashboardUrls.kt)、[DashboardLinkIntegrationTest.kt](../../apps/android/app/src/androidTest/java/org/wikimf/reader/DashboardLinkIntegrationTest.kt)、[dashboard-intents.txt](../../apps/android/verification/dashboard-intents.txt)、[dashboard-links.json](../../apps/android/verification/dashboard-links.json) | 実`/config`からDashboard originを取得しdebug emulator用10.0.2.2:5173へ保存。実ComposeボタンのACTION_VIEWでOverview `/app` とPrivacy `/app/settings/privacy`を捕捉し5.356秒、OK(1 test)。実Chrome handoffは別途確認し、Chrome初回画面の先の表示はST-05。記事/承認URLはA1で検査。 |
| T | [tracker.js](../../packages/tracker/tracker.js)、[android-adapter.js](../../packages/tracker/android-adapter.js)、[ADR](../adr/0001-mvp-contract.md) | 同一JS core。NFC code point/空白除外、200文字chunk、50%可視累計2秒、idle60秒、tick gap>2秒を除外、10秒保存。v1係数は精度の実測保証ではない。 |
| T1 | [tracker.test.js](../../packages/tracker/test/tracker.test.js)、[outbox.test.js](../../apps/extension/test/outbox.test.js) | Node 16件合格（tracker9＋拡張7）。`node --test --experimental-test-isolation=none packages/tracker/test/tracker.test.js apps/extension/test/outbox.test.js`。URL・本文・状態境界・clock/focus・queue・senderを固定入力で確認。 |
| C | [content.js](../../apps/extension/src/content.js)、[worker.js](../../apps/extension/src/worker.js)、[outbox.js](../../apps/extension/src/outbox.js)、[popup.js](../../apps/extension/src/popup.js) | MV3、sole focused active tab、trusted sender/storage、owner/device不変queue、個別ACK、retry/control、browserによる端末連携。 |
| C1 | [chrome-smoke.js](../../apps/extension/test/chrome-smoke.js)、[chrome-fixture.json](evidence/chrome-fixture.json) | 実Google Chrome 154.0.8037.93、専用profile、developer unpacked ID `icjoefpaliiipmidoabflongnndnpmma`。9 checks合格: DOM、content isolation、popup、tab切替、offline永続化、実worker stop/restart、個別ACK。APIはfixture。 |
| C2 | [backend-chrome.js](../../apps/extension/test/backend-chrome.js)、[chrome-postgres.json](evidence/chrome-postgres.json) | 同版の実Chrome、ID `ghkjhcphlkmllnnihmmjokodkdncocdp`、実FastAPI/PG。端末grant作成→pending→Web明示承認→exchange、実tracker2イベントaccepted、1session、active 10,001ms増、queue0。identityと記事metadataは合成。実OAuthの代替ではない。 |
| W | [live-wikipedia.js](../../packages/tracker/test/live-wikipedia.js)、[live-wikipedia.json](evidence/live-wikipedia.json) | 実Chromeで本家JA「地球」/EN「Earth」の現在DOMを抽出。16,290/48,352文字、133/296chunk、38.5/26.8ms、infobox由来chunk0。read-onlyであり、この2記事のクラウド記録の証跡ではない。 |
| B | [main.py](../../apps/backend/wikimf/main.py)、[auth.py](../../apps/backend/wikimf/auth.py)、[articles.py](../../apps/backend/wikimf/articles.py)、[ingest.py](../../apps/backend/wikimf/ingest.py)、[projection.py](../../apps/backend/wikimf/projection.py) | `/api/v1`、User行lock、immutable events/正規化interval、replay、記事ID検証、owner/CSRF/scope、削除marker/epoch、独立公開response、no-store。 |
| B1 | [test_mvp.py](../../apps/backend/tests/test_mvp.py)、[test_auth_flow.py](../../apps/backend/tests/test_auth_flow.py)、[test_recovery.py](../../apps/backend/tests/test_recovery.py)、[test_resolver.py](../../apps/backend/tests/test_resolver.py)、[conftest.py](../../apps/backend/tests/conftest.py)、[最終PGログ](evidence/backend-postgres.txt) | 実PostgreSQL 17.6で75件合格、failure/error/skip 0。認証9件、resolver18件、16同時再送と削除競合、clock-skew削除再送、不正Unicode item混在、identity復元、別session coverage非合成、3ID不一致、同UUIDのuser分離を含む。fixture metadata/provider adapterによる入力で、外部providerの署名・実認証は未確認。SQLite成功だけをPG証跡にしない。 |
| B2 | [verify_recovery.py](../../scripts/verify_recovery.py)、[backend_ops.py](../../scripts/backend_ops.py)、[recovery.json](evidence/recovery.json) | 別PG databaseで実pg_dump/pg_restoreを実行し12 checks合格。空DB migration往復、raw/manual/identityを保持した0002→0003 upgrade、記事/アカウント/epoch削除の非復活、全token拒否・Web session失効・manual非復活・collection/publication OFF、解除identity非復活、backupにない記事のsafety適用。 |
| U | [pages.tsx](../../apps/dashboard/src/pages.tsx)、[App.tsx](../../apps/dashboard/src/App.tsx)、[api.ts](../../apps/dashboard/src/api.ts)、[hooks.ts](../../apps/dashboard/src/hooks.ts) | owner API、library/activity/stats、根拠/手動、privacy/export/delete、identity/device連携、public route、401/error再試行。 |
| U1 | [smoke.mjs](../../apps/dashboard/scripts/smoke.mjs)、[dashboard-fixture.json](evidence/dashboard-fixture.json) | 実Chromeで合成APIの17 checks合格、browserErrors0。手動/削除/consent/public分離、CSRF、identity/device、390px/desktop、dark、401など。スマホ幅は実物理スマホではない。 |
| U2 | [api-smoke.mjs](../../apps/dashboard/scripts/api-smoke.mjs)、[dashboard-postgres.json](evidence/dashboard-postgres.json)、[desktop画像](evidence/dashboard-desktop.png)、[mobile幅画像](evidence/dashboard-mobile.png) | 実HTTP/PGの14 checks合格、browser/serverErrors0。同ownerのAndroidとChrome双方に正の活動があり、source別表示件数がAPIと一致することを確認。snapshot時点の件数・時間はJSONに記録。隔離した合成QA userでcookie/CSRF、stats、filter、privacy、grant承認/exchange、revoke、390px。Google/GitHub実ログインは未実施。 |
| P | [performance.json](evidence/performance.json) | Windows/PG17.6、1user/1article/500session・event・interval、warmup3、各endpoint30 requests。in-process HTTP TestClientでp95はresolver3.33、articles130.29、activities163.11、stats219.73ms。500ms目標をこの条件で満たした。TLS/WAN/実端末の負荷ではない。 |
| I | [GitHub Actions run 37157922359](https://github.com/caprice1026-disc/Wikimf/actions/runs/37157922359)、[配布manifest](evidence/artifact-manifest.json) | source `51d3360da45459aabc61643d4cc74a164de0f556`のbackend/dashboard/tracker-extension/android全4jobがsuccess。PG75件・schema/migration、Dashboard unit/build、tracker/拡張unit/build、Android JVM10件/build/lint。実browser/emulator instrumentation・実OAuthはこのCIの対象外。debug APKと拡張/Dashboard ZIPのhash/build内容を固定済み。 |

上記`evidence/`とAndroid`verification/`には匿名化したreport/画像を保存した。追加修正後の最終SHA/artifactとの対応はリリース記録で確認する。`.tmp/backend-smoke.json`などの資格情報ファイルは証跡へ添付しない。エミュレータ代替は今回のユーザー指示に基づく。物理Android、実provider資格情報、HTTPS配備先、release署名は後日STへ残す。

## Reader / Navigation（14件）

| ケース | 期待する結果 | 実装 | 実行済みの確認 | 判定と残るST |
|---|---|---|---|---|
| N01 | 日本語本家記事、正しいwikiへ記録 | A、AS、T、B | Wの日本語本家DOM、C2のjawiki実PG記録。Android本家表示とbridgeはエミュレータで調査 | 一部。ST-05/07でAndroid JA検索→閲覧→Dashboardを保存。 |
| N02 | 英語本家記事、正しいwikiへ記録 | A、AS、T、B | Wの英語本家DOM、B1のenwiki識別、A3の実Earth→API/PG正active、U2の同owner Dashboard表示 | エミュレータ/API/UI確認。実metadata/Chrome EN記録一式はST-07。 |
| N03 | 前後移動とボタン状態一致 | A | A4のnative Earth→Moon→back Earth→forward Moon、回転後も往復/履歴維持 | エミュレータの前後移動確認。ボタン無効境界・3記事・OS backはST-05。 |
| N04 | 履歴なしの前後無効、上部backで終了しない | A | 無効条件と上部操作の実装を確認 | ST。ST-05で初回/履歴末端/OS backとの違いを操作。 |
| N05 | アンカーで記事数/sessionを増やさない | A、T、C | T1のfragment除外、A4のEarth#Physical_characteristicsで同session・scroll1800維持 | エミュレータの同Document確認。記事数差分とChrome fragment往復はST-05/08。 |
| N06 | 外部HTTPSへ外部browser、計測停止 | A、T | A1のexternal分類、host/lifecycle停止実装 | 一部。ST-05でgesture付き外部リンクと復帰時の区間を確認。 |
| N07 | 偽host/userinfoでReader/bridgeを越えない | A、T、C | A1/T1/B1のURL検査、C1のcontent資格情報アクセス拒否 | 下位層確認。ST-05/08で実遷移・iframeにbridge/tokenがないことを確認。 |
| N08 | javascript/file/任意Intentを外部起動口にしない | A | A1のscheme拒否、external起動のallowlist | 下位層確認。ST-05でリンク・新window・共有入力から同じ拒否を確認。 |
| N09 | 新windowもURL検査し一つのReaderまたは外部へ | A | temporary bridge-free WebView→分類→destroyの実装を確認 | ST。ST-05でtarget=_blank、無人popup、不許可URLを操作。 |
| N10 | Account往復で位置/履歴維持、時間除外 | A、T | A3のAccount滞在12秒でactive増分0。A4のReader/Search往復ではURL/scroll1800/history/session維持、focus復帰 | 一部。ST-05でAccount往復の位置/前後履歴も明示照合。 |
| N11 | 回転/文字サイズで不要reload/二重sessionなし | A、T | A4のlandscape/portraitでMoon位置1030.545と履歴維持、回転後のnative前後移動を確認。Activity再作成ごとに新sessionを観測 | 一部。位置/履歴復元はエミュレータ確認。session再作成のreload/二重計上条件と文字サイズはST-05。 |
| N12 | プロセス終了後は新session、停止時間除外 | A、AS、T | T1のgap除外、A2のqueue再open | 一部。ST-05/09でforce-stop→復帰→再送を行い、停止時間と新sessionを照合。 |
| N13 | 別hostの画像表示を保ちbridgeを公開しない | A | top-frame origin限定とサブリソース非遮断。A1のsubframe拒否 | 一部。ST-05でWikimedia画像・CSS表示とsubframe listener不存在を確認。 |
| N14 | SSLエラー/renderer停止で安全停止、再試行 | A | SSL cancel、onRenderProcessGone→stop/destroy/retryの実装 | ST。ST-05でテスト証明書エラーとrenderer killを注入し未計測区間を確認。 |

## Search（14件）

| ケース | 期待する結果 | 実装 | 実行済みの確認 | 判定と残るST |
|---|---|---|---|---|
| S01 | 空入力で閲覧/検索の2履歴 | A、AS | owner/language別の2履歴実装、A2のowner分離 | 一部。ST-06で同意前後、空入力、両履歴の表示順/20件を確認。 |
| S02 | 1文字でdebounce後候補 | A、AS | 300ms debounceと世代/キャンセル実装 | ST。ST-06で日英1文字・連打時の画面とリクエスト数を記録。 |
| S03 | 日本語IME変換中の連続問い合わせ抑制 | A | input.composition中の抑制実装 | ST。ST-06で実IMEの未確定→確定、削除、言語変更を操作。 |
| S04 | Enter/IME検索で本文検索 | A、AS | candidate/title検索とfull/page検索の分岐実装 | ST。ST-06でEnter/検索キーと候補にない本文語を確認。 |
| S05 | 候補から正しい記事へ | A、AS | A4のNative検索からEN Earth/Moonへ遷移し実URL表示を確認 | 一部。ST-06で候補/本文結果の区別、JA/EN同名候補と実resolver IDを照合。 |
| S06 | 候補表示だけでは検索履歴を作らない | A、AS | rememberを選択時だけ呼ぶ実装 | ST。ST-06で候補表示→閉じる→再openし履歴差分0を確認。 |
| S07 | 結果から開いた記事を検索履歴へ | A、AS | onChoose時のsearched履歴実装、A2の保存基盤 | 一部。ST-06で再選択が先頭へ移動し重複しないことも確認。 |
| S08 | 言語変更後、古い応答で上書きしない | A、AS | A1のSearchGate旧言語/full/cancel拒否 | 下位層確認。ST-06でHTTP応答を逆転しUIが最新世代のままか確認。 |
| S09 | 0件と通信エラーを区別 | A、AS | loading/empty/errorの分離実装 | ST。ST-06で実0件とmock 500を出し文言/再試行を保存。 |
| S10 | offline/429でも履歴選択・retry/抑制 | A、AS | A1でRetry-After秒値/date/不正時30秒、wiki別process期限と最新世代を確認。検索待機/HTTPのcancel、履歴選択/error/retryを実装 | 下位層確認。ST-06で実HTTP429注入、待機中の入力/言語/画面再open、offline履歴選択・復帰を照合。 |
| S11 | 説明なし/長いtitleでも崩れない | A | description fallbackとCompose wrap実装 | ST。ST-06でnative検索の狭幅/大文字サイズを確認。U1の長titleはDashboardだけの証跡。 |
| S12 | HTML excerptを実行せずテキスト表示 | A、AS | excerptのHTML除去→Compose Text実装 | ST。ST-06でscript/img/onerror入りfixtureを表示し実行0を確認。 |
| S13 | 削除した履歴が再表示/他account混入しない | AS | A2のclearHistoryとowner分離、A1のqueue owner制約 | 下位層確認。ST-06/10で画面再open/再起動/user変更後も空を確認。 |
| S14 | 既定検索言語変更で現在記事を移動しない | A、AS | 設定と現在Reader URLを別状態で保持 | ST。ST-06でJA記事中にEN既定へ変え、現URLと次回検索を確認。 |

## Tracking / 状態（18件）

| ケース | 期待する結果 | 実装 | 実行済みの確認 | 判定と残るST |
|---|---|---|---|---|
| R01 | 5秒離脱は自動閲覧件数に入らない | T、B | T1/B1の10秒未満、B1の5秒session非投影 | 判定層確認。ST-07で両hostの5秒操作後Dashboardを確認。 |
| R02 | active10秒のviewed境界一致 | T、B、U | T1/B1の9,999/10,000ms、C2の10,001ms、A3の約21,992msでviewed、U2の同owner両source表示 | Chrome/エミュレータ/PG/UI確認。ST-07で両hostの閾値直前/直後を追加照合。 |
| R03 | active30秒＋必要coverでpartial | T、B | T1/B1の30秒/cover境界、A3の44,980msと120,629msでpartial | 判定/エミュレータ確認。ST-07で実可視chunkと30秒前後を照合。 |
| R04 | 80%cover＋必要時間でcompleted | T、B | T1/B1の79,999/80,000ms固定入力 | 判定層確認。ST-07で日英双方の閾値前後とspeed capを確認。 |
| R05 | End jumpで中間chunkをcoverしない | T | T1の未表示jump、実Rect/サンプル間の可視継続判定 | 下位層確認。ST-08で実Chrome End→末尾2秒のcovered IDsを照合。 |
| R06 | idle/sleep/lockの条件外時間なし | A、T、C | T1のfocus/idle/gap/clock、C1のactive tab切替、A4のHome background12秒でactive増分0/復帰同session | エミュレータbackground確認。実OS sleep/lockとclock/gapの端末実操作はST-05/08。 |
| R07 | Native検索中はvisible WebViewも停止 | A、T | A4の実Search表示でfocus=false、Reader復帰でtrue、同session/位置維持。A3の正active再開 | 一部。停止条件の実画面確認。ST-05/07でSearch滞在中のAPI active増分0も数値照合。 |
| R08 | 60秒静止の過小評価と説明/再開操作 | A、T、C、U | T1のidle60秒除外、計測限界の説明実装 | 一部。ST-07/12で70秒静読→scroll再開の時系列と理解を記録。 |
| R09 | 長段落/折りたたみを実viewportで判定 | T | T1の5000chunk近傍計算・collapsed denominator/Rect除外、C1の実DOM | Chrome fixture確認。ST-05/08でモバイル折りたたみ・zoom・再展開を確認。 |
| R10 | infobox/脚注/navを文字数から除く | T | T1/C1の除外・NFC、Wの実日英でinfobox chunk0 | Chrome本文抽出確認。ST-05/12でAndroid DOMと数式/表/箇条書きも比較。 |
| R11 | 抽出失敗/本文0はtime_onlyで読了なし | T、B、U | T1/B1のno_body、null文字数/空chunk、viewed上限 | 判定/API確認。ST-07でhost上の抽出失敗を注入しUI理由表示を確認。 |
| R12 | 本文変化でDocument/session分割 | A、T、C | fingerprint変化→flush/new session、同本文DOM再構築でRange更新の実装 | ST。ST-07/08で動的本文更新と同本文差替えを分けID/終了理由を確認。 |
| R13 | oldid/diff/searchを自動実績対象外に | A、T、B | A1/T1/B1のURL対象外検査 | 下位層確認。ST-05/08で実wiki対象外画面と通常colon/curid記事を操作。 |
| R14 | 再読で活動/時間増、種類数は不変 | B、U | B1の3session/1記事、最大文字数と日別増分 | PG集計確認。ST-07で端末を変え同記事を再読しUI履歴を照合。 |
| R15 | 同主題JA/ENは別記事 | AS、T、B | Wの日英、B1のjawiki101/enwiki202別Articleと重複時間union | 識別/PG確認。ST-07で実metadataの同主題を両hostから読んで照合。 |
| R16 | 手動読了で時間/文字数を作らない | B、U | B1の30秒不変、U1のmanual-auto-state/CSRF | API/UI確認。ST-10で自動なしの記事と称号/publicの差分も確認。 |
| R17 | 手動解除で自動状態へ戻る | B、U | B1のcompleted解除→partial、U1のreset | API/UI確認。ST-10で解除後の追加自動観測を確認。 |
| R18 | 別sessionの半分coverを合成しない | B、T | B1で同fingerprint2session各60秒/別の50%chunkを送り、総時間120秒でもpartial、文字数300/600を維持 | PG確認。ST-07で実hostのsession分割・部分読みを追加照合。 |

## 同期 / DB / プライバシー（24件）

| ケース | 期待する結果 | 実装 | 実行済みの確認 | 判定と残るST |
|---|---|---|---|---|
| D01 | 同event10回で1回分 | B、AS、C | B1のaccepted1/duplicate9、実PG16同時送信でaccepted1 | PG確認。ST-09で端末から同IDをoffline再送。 |
| D02 | 同ID内容変更はconflict拒否 | B、AS、C | B1のmax_scroll改変event_conflict、A2のpayload不変 | PG/端末storage確認。ST-09でinterval/document改変も拒否を確認。 |
| D03 | 逆seq/open/closed欠落でも未着時間補完なし | B | B1のseq3→1で20秒だけ計上、pending、矛盾seq2隔離/再計算 | PG確認。ST-09で実端末配送順を入れ替え表示も確認。 |
| D04 | ACK紛失の同ID再送はduplicate | B、AS、C | B1のduplicate、T1の未着ACK保持、C1の再送後個別削除 | 部品/実Chrome確認。ST-09でサーバcommit後responseだけ遮断する障害を注入。 |
| D05 | worker停止/app killでも保存queue保持 | AS、C | C1の実worker停止/復帰、A2の実SQLite再open、A4の実offline2件→online後0/正active/非隔離 | Chrome/storage/エミュレータoffline確認。Android force-stop/reboot後の送信はST-09。 |
| D06 | PC/Android重複時間をunion | B | B1の60秒＋30秒ずれ60秒→90秒、replay一致（入力は合成端末） | 実PG計算確認。ST-07で実2hostの同時観測を同userへ送る。 |
| D07 | 同user並列送信の統計一致 | B | B1の実PG8worker/16再送と削除競合、replay2回一致 | PG確認。ST-09/12で異なるevent並行と大量履歴の再計算を測定。 |
| D08 | revoke/user変更で別userへ送らない | B、AS、C | B1/U2のrevoked token401、A1/A2/T1のowner/device不変 | API/storage確認。ST-09で両hostに旧queueを残したままaccount変更。 |
| D09 | article_idとwiki/pageid不一致拒否 | B | B1で3IDを1つずつ改変しarticle_mismatchを確認。session/event作成なし、library/時間増分0 | PG確認。ST-09で実端末の配送に改変を注入し追加照合。 |
| D10 | 他user session/article状態更新拒否 | B | B1の他user library/state404、端末の管理scope403、bad user_id拒否。同session/event UUIDで別userの記録を作っても元userのrecord/evidence/stats不変 | PGでuser namespace分離確認。同UUID自体を禁止する必要はない。ST-02/10で実provider/端末をまたぐ境界を追加照合。 |
| D11 | 記事削除後の旧イベントで復活なし | B、AS、C | B1のhistory_deleted/PG削除競合/clock-skew再送、T1 control purge、B2の復元後非復活、U1 reload | PG/Chrome/UI確認。ST-10でoffline Android旧queueも含め確認。 |
| D12 | 全削除後旧epoch拒否、端末旧queue処理 | B、AS、C | B1のepoch2と旧reject、T1/A2のepoch処理、B2の復元非復活 | PG/storage確認。ST-10で両hostの旧queue・新session再開を照合。 |
| D13 | private profile URLで個人情報なし | B、U | B1の404、U1 public独立schema/私的API未呼出 | API/UI確認。ST-10で匿名・他user・CDN/browser cache越しに確認。 |
| D14 | manualのみ/未投稿からpublic feedへ出ない | B、U | MVP-Aにfeedなし。manualはauto metricsを増やさず独立public responseは時間/称号の許可項目のみ（B1/U1） | 境界一部確認。ST-10でmanual-only記事のpublic本文/title副作用0を確認。feed追加はM11以後。 |
| D15 | 同emailの異providerを自動結合しない | B | provider+subject識別（emailを結合keyにしない）。B1/認証9件は合成provider | 下位層確認。ST-02で同email実Google/GitHubの別userを確認。 |
| D16 | 明示identity追加で両providerから同user | B、U | B1/認証9件の意図/provider/state結合、replay拒否、並列provider追加。実provider未実施 | ST。ST-01/02で実Google→GitHub追加→双方logout/loginのuser一致を確認。 |
| D17 | 最後のidentity解除拒否 | B、U | B1 last_identity拒否、U1 UI無効化 | API/UI確認。ST-02で実2identityから1件解除後も最終1件を保護。 |
| D18 | 逆引きの正規ID/redirect/missing/stale区別 | B | B1のID逆引き/public fields/missing404、PG resolver18件でredirect/alias/stale/missing/8並列resolveを確認 | PG確認。ST-07で外部MediaWikiのredirect/削除/移動・期限切れcacheを確認。 |
| D19 | migration前後でデータ/制約/集計維持 | B | B2の空DB migration往復、raw3/manual3/identity4を保持した0002→0003 upgrade、実dump/restore12項目 | 保持データmigration/復旧確認。ST-11で配備先のmigration失敗復旧とreplay一致を追加確認。 |
| D20 | timezone日跨ぎで総時間=日別合計 | B、U | B1のTokyo日跨ぎ/増分合計、U1/U2のtimezone入力/URL | PG/UI確認。ST-07でNYのDST/UTC境界、長区間、重複日跨ぎを追加。 |
| D21 | logにtoken/不要検索語なし | A、AS、T、C、B | C1 content資格情報アクセス拒否、T1 payload余分項目拒否、B1 export秘密除外、A2暗号化 | 一部。ST-03/09で実proxy/access/crash/logcat/配布生成物を合成canaryで走査。秘密値を証跡に残さない。 |
| D22 | Outbox上限で無言上書きせず停止/通知 | AS、C | T1の7日期限で新観測拒否、容量拒否/通知実装。Chrome8MiB/Android10MiB | 一部。ST-09で上限到達と実disk/quota失敗、queue不変/通知を確認。 |
| D23 | 異常未来/過去を無条件計上しない | B、AS、C | B1の未来6分reject、T1のclock/gap/queue期限 | 一部。ST-09で過去7日超・時計±変更・Retry-Afterを実配送で確認。 |
| D24 | 個人response cacheを別userへ出さない | B、U | API no-store実装、B1のuser分離、U1のpublic独立route/401 | 一部。ST-03/10で実HTTPS proxy/CDNとbrowser戻る/再loginを2userで確認。 |

## 工程ゲート（G00～G10）

| Gate | 現時点の判定 | 根拠と残件 |
|---|---|---|
| G00 | 閉じた検証の基盤・remote CI・artifact固定を確認 | ADR/契約/schema/各buildと上記suite。Iの最終配布source全4job success、3artifactのSHA256/build内容/共通tracker一致。HTTPS/署名の環境受入はST-03/04。 |
| G01 | エミュレータ操作を一部確認 | A1のURL/bridge、A4の前後/fragment/Search往復/回転位置履歴/backgroundを確認。N04/N06～09/N12～14と文字サイズはST-05。物理実機未実施。 |
| G02 | 一部確認 | 検索/履歴実装、SearchGate JVM・SQLite確認。実IME/429/画面順序はST-06。 |
| G03 | 実provider未確認 | 実API端末grant・承認・exchangeとuser/scope/CSRF、認証9件は確認。実Google/GitHubログイン/identity追加はST-01/02。 |
| G04 | PG識別/cacheと本家queryを確認 | B1のresolver18件、実MediaWikiの日英query/redirect読取り。上流の記事移動/削除をまたぐ縦断と期限切れcacheはST-07。 |
| G05 | Android→API/PG→同owner Dashboardをエミュレータで確認 | A3の実Earth DOM/viewed/partial、A4のoffline recovery/停止、U2の同owner表示。time_only障害注入はST-07、物理端末はST-05へ残す。 |
| G06 | core/API境界確認、host ST残り | T1/B1/U1、W実日英DOM、C1実fixture。モバイル折りたたみ、端末3状態と根拠説明はST-05/07/12。 |
| G07 | 両host→同owner Dashboard経路を確認 | C1のworker停止/復帰、C2の実tracker→PG、A3/A4のnative実観測、U2の両source表示。identity/metadataは合成。実metadataの縦断一式はST-07。 |
| G08 | 実PGの計算/並行性と限定性能を確認 | B1のunion/逆順/再読/日跨ぎ/replay/並列削除。Pの500session・local TestClient p95を確認。ST-07/09/12で実2host同時区間・DST・TLS/WAN/大量履歴を補う。 |
| G09 | API/UI/復旧の確認あり、配備cache/端末ST残り | B1/B2、U1/U2、owner storage/epoch確認。両hostの停止/別account/旧queueと実HTTPS cacheはST-03/09/10。 |
| G10 | 一般公開のリリース判定は保留 | 実装・閉じた検証・source/artifact固定は完了。ユーザーの指示でエミュレータを先行し、実OAuth/HTTPS/署名/物理実機を後日STへ残す。ST-01～13の実環境/利用評価を完了し、公開する配布対象のSHA/artifactを再照合して公開可否を別途判定。 |

## 実行結果を更新する条件

新しい確認では、ケースID、source SHA、artifact hash、OS/Chrome/WebView/API/PG版、操作、期待値、実際の値、匿名化したreportパスを記録する。合成provider/metadataを置換したかも記す。修正で影響したケースと必須suiteを最終対象で再実行し、失敗/skipは理由を残す。今回のA3は正のactive縦断とAccount停止を確認した範囲だけ更新し、他の未実施STを一括合格にしていない。
