# Issue #14〜#18 を修正し、Web ダッシュボードを刷新する

この計画は `PLANS.md` に従う生きた文書であり、実装と検証の進行に合わせて更新する。

## Purpose / Big Picture

端末連携コードの漏えい、削除済みデータの端末残留、記録停止からの復帰不能、同意停止中のURL送信を修正する。重要操作には直近の本人確認を要求する。Web ダッシュボードでは最近の記事を中心に読書の蓄積を読み取れる画面へ刷新し、実Chromeのデスクトップとモバイル幅で操作を確認する。ユーザーの指定どおり、意匠変更の対象はWebダッシュボードである。

## Progress

- [x] (2026-10-04) 新規Issue #14〜#18、現在のコード、Dashboard設計書、既存検証環境を確認した。
- [x] (2026-10-04) #14 のコード非開示・hash保存・migration・Backend回帰を完了した。実端末pairingの再確認を統合時に行う。
- [x] (2026-10-04) #15/#17 のAndroidデータ削除と送信同意境界を実装し、実エミュレータ8件・JVM10件・build/lintで確認した。
- [x] (2026-10-04) #16 のChrome復旧処理を実装し、unit12件・実Chrome復旧12判定・既存9判定・実APIpairing/ACKを確認した。
- [x] (2026-10-04) #18 の直近認証と同一利用者確認、Dashboard導線を検証した。独立レビューで発見したlogout競合とlock待ち期限越えを修正し、PG全95件成功。
- [x] (2026-10-04) Dashboardの全主要画面を刷新し、desktop/mobile/dark/empty/errorと26操作シナリオを確認した。
- [ ] READMEと検証記録を更新し、mainへpush、remote SHA/CIとIssueの状態を確認する。

## Surprises & Discoveries

AndroidはSyncだけでなくReaderのページ完了時にもresolveを呼ぶため、API共通境界の同意確認が必要だった。OAuth providerのaccount pickerはパスワード再入力の保証ではない。実OAuth設定がないため、プロバイダーの実認証画面は引き続きSTで検証する。

独立レビューで、session存在SELECTと新session発行の間にlogoutがcommitできる競合、Userロック待ち中に10分を越えたlinkの成功を再現した。旧sessionをDELETE RETURNINGで原子的に消費してから変更する方式へ改め、待機後とcommit前に期限を再確認した。再現3ケースを含むPG全95件が成功した。Dashboardでは選択中providerを解除した後も旧providerへ再確認POSTする問題を修正し、残存providerを選ぶ回帰を追加した。

## Decision Log

2026-10-04: 作業をBackend、Android、Chrome、Dashboardに分割する。既存依存を使い、共通ファイル、ExecPlan、Git/Issue操作はrootが統合する。

2026-10-04: 確認コードは開始応答の元端末だけへ返す。短いcodeはsalt付きPBKDF2で保存する。移行時は短命の既存連携要求を失効させる。連携済み端末と読書履歴は保持する。

2026-10-04: Web認証から10分を重要操作の有効期間とする。既存sessionの移行では認証時刻を捏造せず再確認を要求する。再確認intentはCSRF付きPOSTで開始し、元sessionと利用者に結び付ける。成功時はsession/CSRFを更新する。追加identityで確認時刻を更新せず、追加開始・完了時にも有効な確認を要求する。全履歴削除、account削除、identity追加/解除、公開情報の拡張を対象とする。非公開への変更は妨げない。

2026-10-04: Androidは送信Outboxと最大100件の診断を分離し、送信不能payloadを削除する。control取得と削除処理の後、同意・collectionを確認してからURL解決とbatch送信を行う。停止中は保持/破棄、再同意時は保持分同期という既存方針を画面へ明記する。

2026-10-04: 重要操作のcallbackは旧sessionを同一transactionで原子的に消費し、logout済みなら新sessionを発行しない。失敗時は消費をrollbackする。認証期限はlock待機の後にも確認する。再確認のUIはprovider解除後に存在するproviderから選び直す。

## Outcomes & Retrospective

Backendは実PG full90件と追加2ケースを含むsecurity suite17件が成功。既存認証suiteでは同時に開始した2つ目のlinkが先行linkによるsession更新で403となるため、以前のprovider重複409からsession変更拒否へ期待値を更新した。データを保持した0002→0004移行と実dump/restoreは14項目成功。実OAuth、HTTPS、署名配布、物理端末の受入は既存Issue #13のSTを継続する。新しい不具合のローカル検証と実プロバイダーの検証を混同しない。

追加修正後はPG全95件、Android JVM10/native8+pairing1件、Chrome unit12/復旧12/既存9判定、Dashboard26 workflowが成功した。Backend92629dc、Chrome01febf0、Android60801e5をmainへ順次pushし各remote SHAとCI成功を確認した。最終Dashboard commitと配布物の対応付けを進める。

## Context and Orientation

作業ディレクトリは `C:\Users\Hodaka\Downloads\div\Wikimf`。`apps/backend/wikimf/main.py` はHTTP route、`auth.py` はsession/OAuth認証、`db.py` はDB定義、`apps/backend/migrations/versions` は既存DBを更新する手順を保持する。`apps/backend/tests` のfixtureはテストごとに独立PostgreSQL schemaを使う。

`apps/android` はKotlin Readerで、Storage.ktのOutboxは未送信読書eventのSQLite保存領域である。quarantineは再送不能と判定したイベントの診断を意味する。`apps/extension/src/worker.js` はChromeの記録可否と同期を制御し、leaseは一つのactive tabに計測を許可する仕組みである。`apps/dashboard` はReact/TypeScript/Viteで、個人情報は実APIから取得する。見栄えのための架空値を製品へ追加しない。

## Plan of Work

最初にBackendの再現テストを追加し、Web GETに確認codeが含まれることと古いsessionで重要操作が通ることを確認する。DB migration 0004でcode hashと認証時刻を導入する。通常ログイン、追加identity、再確認をstateごとに区別し、再確認が異なる利用者の作成や切替にならないようにする。

Androidではversion 1のquarantined payloadを診断へ変換して削除するversion 2 migrationを追加し、有効queueとlocal historyを保持する。期限超過、epoch（全消去の世代）不一致、記事削除marker、拒否ACKを同じ破棄関数へ集める。Chromeではrecoverableなqueue errorだけを原因解消後に戻し、device/schema/owner errorは保持する。

Dashboardは既存設計書のEditorial/Quiet/Data-richを基準とし、画像conceptを作成して配置・配色を決める。主要画面、ナビゲーション、記事行、期間選択、統計、Account/Privacy、空/読み込み/失敗状態を統一する。コードnativeの文字と操作を維持し、再確認の案内を重要操作へ統合する。

## Concrete Steps

ルートから `.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider` を実行する。実PG検証は `TEST_DATABASE_URL=postgresql+psycopg://wikimf@127.0.0.1:54329/wikimf` を環境変数へ指定する。`scripts/generate_contracts.py --check` で生成済み契約を確認する。migrationと復旧は `scripts/verify_recovery.py` の隔離DBで確認する。

Dashboardは `npm.cmd --prefix apps/dashboard run build`、`npm.cmd --prefix apps/dashboard test`、起動済みQA APIとViteへ `npm.cmd --prefix apps/dashboard run test:api` を実行する。Chromeは `node apps/extension/test/backend-chrome.js` と既存のworker検証を使用する。Androidの具体コマンドは同ディレクトリのVERIFICATION.mdへ実行結果と共に記録する。

## Validation and Acceptance

確認codeはstart応答にのみ存在し、Web GETとDBからraw codeを取得できず、誤codeでattemptが増え、正codeでのみ承認できる。古いsessionで重要操作は403になり、CSRFも必須のままとする。既存providerの同一subjectで再確認したときのみ許可され、別subjectやsession切替では権限を上げない。正常OAuth linkのstate/PKCEを維持する。

Androidの期限/epoch/deletion後はDBにfull payloadが存在せず、診断100件上限と新event保存を確認する。同意OFF/collection OFF中はcontrol以外の読書URL/event通信が0であることをfake HTTP serverとエミュレータで確認する。Chromeはqueue_full→discardとqueue_expired→control cleanupで記録を再開し、terminal errorは保持する。

Dashboardは1440pxと390pxを基本に、overflow、コントラスト、keyboard focus、モバイルナビゲーション、reduced-motionを点検する。既存機能のChrome fixture/API suiteを通し、スクリーンショットで変更を比較する。

## Idempotence and Recovery

各回帰テストは独立DB/schema/profileを使用する。既存の実データは削除しない。migration前には必要に応じ既存backup runnerで退避する。0004 upgrade/downgradeは連携待ち要求を破棄するので元端末から5分有効の連携を再開始する。既存OAuth設定や端末tokenをログへ出さない。remote書込みが不明ならGitHubを読んでから再試行する。

## Artifacts and Notes

開始時mainは `823011a7180da18207a31c6eeb7b9c3f45eb3d69`、worktreeはclean。旧配布物は `dist/0.1.0-51d3360da454` に固定済みであり、新しい修正の証拠として使い回さない。新検証結果と画面は別証跡へ記録する。

## Interfaces and Dependencies

追加ライブラリは原則不要。BackendはPython標準hashlib/secrets、既存AuthlibとSQLAlchemyを使う。再確認は `POST /api/v1/auth/{provider}/reauthenticate?return_to=...` が `authorization_url` を返す。`/me` は `recent_auth_until` を返す。重要操作は期限外で `reauthentication_required` を返す。Dashboardは既存providerを選んでこのPOSTを呼び、戻った後の削除等は自動再試行しない。

更新記録: 2026-10-04、新規Issue5件とDashboard刷新の実行計画を作成した。

更新記録: 2026-10-04、Backend修正の回帰とmigration/復旧の成功、provider再確認の保証範囲を反映した。

更新記録: 2026-10-04、実クライアントの確認、Dashboard刷新、独立レビューによる競合修正と段階pushを反映した。
