# エミュレーター検証を完了し、実機ST用release APKを用意する

このExecPlanは `PLANS.md` に従い、実施結果と未確認事項を更新する。

## Purpose / Big Picture

ユーザーが自分のAndroid 1台へ署名済みrelease APKを入れ、実Wikipediaと実Backendを使って読書からDashboardまで確認し、その後3〜7日普段使いできる状態へ進める。今回の完了対象は、方針の更新、エミュレーターで可能な機能検証と不具合修正、APKの作成・検査である。物理端末での操作と数日間の利用は後続STに残す。実OAuth資格情報とHTTPS配備先は従来未準備であり、新たな提供がない限り確認済みにしない。

## Progress

- [x] (2026-10-04) 現行main `3ea45b0`、ST計画、Android buildと既存証跡を確認した。
- [x] (2026-10-04) ST方針を6段階と実機1台・3〜7日利用へ更新した。ユーザーからHTTPS接続先は未準備との回答を受けた。
- [ ] エミュレーターの不足ケースを実行し、問題を修正する。
- [ ] debugと分離したST専用release署名を準備する。
- [ ] 機能確認後にrelease APKを作成し、署名・manifest・起動・基本操作を確認する。
- [ ] README、受入記録、Issue #13を更新し、mainへpushしてremote SHAとCIを照合する。

## Surprises & Discoveries

現状のrelease APKは未署名である。API URLはAccountで変更できるため、HTTPS配備先が未準備でもインストール用APKは作成できる。初期値 `https://wikimf.example/api/v1` は説明用の未接続先であり、クラウド連携の成功証拠にしない。debugだけがエミュレーターのHTTP接続を許可し、releaseではHTTPSが必須である。

実MediaWiki APIへ接続できたため、合成記事を持たない `wikimf_live_smoke` DBとport8002の標準Backend、port5174のDashboardを準備した。日本語「地球」のpage_id2460204、英語「Earth」の9228を実API経由で取得・保存できた。認証identityは合成のままである。

## Decision Log

2026-10-04: ユーザー指定の順序を採用する。Phase 1はエミュレーター＋API/PG/Dashboardの機能確認、Phase 2はrelease APK作成、Phase 3は自分の実機1台へのsideload、Phase 4は実WikipediaからDashboardへの縦断、Phase 5は実機固有の挙動、Phase 6は3〜7日の自己利用とする。実機では既存の全テストを繰り返さず、WebView・ライフサイクル・回線・ブラウザ連携・Keystore・操作感を優先する。

2026-10-04: releaseのdebuggable化、HTTP許可、TLS検証の無効化を検証目的で導入しない。ST署名鍵をdebug/正式公開用と分離し、秘密値はGit対象外のローカル領域に保持する。既存debug installは別署名のため上書きできない。検証用の別エミュレーターまたはデータを保持する方法を選び、既存Readerデータを無断消去しない。

2026-10-04: 同じsourceの既存成功記録を再利用し、不足ケースと変更の影響範囲を追加確認する。停止・offlineの証拠には実測したqueue、ACK、sessionとactive時間を使い、単なる起動やテストのskipを合格に数えない。

## Outcomes & Retrospective

着手時点。今回作るAPKのインストール可能性と、未準備の実HTTPS/OAuthを含むクラウドSTの完了は分けて報告する。

## Context and Orientation

作業場所は `C:\Users\Hodaka\Downloads\div\Wikimf`。`apps/android/app/src/main/java/org/wikimf/reader/MainActivity.kt` がReader・検索・AccountとWebViewのライフサイクル、`Api.kt` がAPIとWorkManagerの同期、`Storage.kt` がSQLite OutboxとKeystoreによる認証情報保存を扱う。Outboxは送信前のイベントを永続化する領域、ACKはAPIがイベントごとに返す受理結果である。`app/build.gradle.kts` と `build.ps1` がビルド設定、`verification/` と `VERIFICATION.md` が実行証拠を保持する。

API35の既存エミュレーターは `emulator-5554`。ローカルQA APIはPCの127.0.0.1:8000、端末から10.0.2.2:8000、PostgreSQLは54329。`scripts/local_smoke_server.py` は実FastAPI/PGを使うがidentityと記事metadataは合成である。実記事表示は公開Wikipediaを使用する。資格情報はignored `.tmp/backend-smoke.json` にあり、ログ・文書へ出さない。

## Plan of Work

最初に `docs/releases/ST-plan.md` の実施順と実機範囲をユーザー方針へ更新する。受入の70ケースは維持し、今回のエミュレーター証拠への参照を追加する。Phase 1では既存のSQLite/同意/削除/回転/bridge検証に、不足するprocess killと再起動、画面OFF、実WorkManagerのoffline復旧、日英検索遷移を加える。問題があれば本体の最小修正と対応する再現テストを残す。

次に署名設定を環境変数から受け取れるようにする。秘密をコードやCIの出力へ含めず、ST鍵の再利用手順を用意する。機能確認が通った後にrelease APKを生成し、Android SDKのapksignerで証明書と署名を検査し、manifestのdebuggable/cleartext設定と既存tracker assetを照合する。release版を隔離エミュレーターへ入れて起動とWikipediaの基本操作を確認する。実HTTPSが未提供の場合はクラウド縦断を未実施として残す。

最後にsourceをcommitして配布APKへSHAとhashを対応付ける。READMEにAPKと実機移行手順を示し、Issue #13へ先行結果と後続作業を記載する。機能単位でmainへpushし、GitHub側のSHAとCI状態を確認する。

## Concrete Steps

ルートから `powershell -ExecutionPolicy Bypass -File apps/android/build.ps1` を実行し、JVM・debug build・lintが成功することを確認する。実端末テストは `apps/android/.tooling/sdk/platform-tools/adb.exe -s emulator-5554 shell am instrument -w` に既存のAndroidJUnitRunnerと明示的なnative検証flagを指定する。外部依存を持つテストはflagなしのskipを合格として扱わない。

release署名の具体コマンド、APK出力パス、証明書digest、エミュレーターの実測と失敗修正は実施後にこの計画と `apps/android/VERIFICATION.md` へ記録する。新規のcloud配備や正式公開は今回行わない。

## Validation and Acceptance

画面OFF/background/kill中に読書active時間が増えず、復帰後に適切なsessionで再開する。offlineのイベントと認証情報がプロセス終了を越えて保持され、ネットワーク復帰後にWorkManagerからAPI ACKを得てqueueが減り、Dashboardへ反映される。削除epochと同意OFFの既存境界を壊さない。日英Wikipediaの検索と表示を実行し、失敗時の条件を記録する。

作成APKはrelease build、ST専用署名、debuggable false、cleartext禁止であり、署名検査と隔離端末へのインストールに成功する。未提供のHTTPS/OAuth、物理端末・実回線・実IME/Keystore・3〜7日利用は後続STと明記する。

## Idempotence and Recovery

既存QA履歴とdebug installを保持する。テスト用user/device/schemaの作成と破棄は対象IDを限定し、全体のdata clearや再インストールによる消去を避ける。鍵が既に存在する場合は上書きせず再利用する。署名設定が欠けた場合は署名済みと偽らず失敗させる。停止したネットワーク・画面設定は検証後に復元する。

## Artifacts and Notes

既存source `dd575fb` のPG95件、Android JVM10/native8+pairing1、ChromeとDashboardの検証は `docs/releases/issue-fixes-dashboard.md` に残す。今回の証拠は別ファイルへ保存し、歴史的な値を上書きしない。

## Interfaces and Dependencies

既存のAndroid SDK/JDK17/Gradle8.9、AndroidX WorkManager、SQLite、Keystoreを使用し、新しい製品依存は加えない。release署名の設定口はlocal/CI環境へ限定する。正式公開用の鍵管理とStoreへの提出は後続作業である。

更新記録: 2026-10-04、ユーザーの実機ST方針に基づき計画を作成した。
