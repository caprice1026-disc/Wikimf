# リポジトリ全体レビューと OAuth 回復の実行計画

## Purpose / Big Picture

承認済みLAN修正のmain@c94dfd19から、Backend、Dashboard、Android、拡張、共通契約、ビルド・配布・設定を確認する。再現した不具合だけを既存Issueへ関連付け、修正と該当環境の検証を残す。#30の通常OAuth取消・失敗を安全な回復画面へ戻す。外部OAuth資格情報を作成・登録せず、合成providerの証拠と実provider未検証を区別する。#29の公開デプロイは行わない。

## Progress

- [x] (2026-10-12) main/c94dfd19と作業ツリーcleanを確認。AGENTS/PLANSの手順を継続。#37/#38のレビュー由来修正は前工程で検証・close済み。
- [x] #30を既存provider fixtureで再現し、DB/既存セッション非変更、検証済み戻り先、replay拒否と再試行を確認する。
- [x] 通常loginの回復redirectと、ログイン済みでも失敗表示を残すDashboardを修正してブラウザ検証する。
- [x] 全実装の境界と代表フローを確認し、具体的な問題を起票・修正・検証する。
- [x] 許可済みDB/設定バックアップを保護し、別DBへの復元を確認する。停止・圧縮前に親へ結果を返す。
- [ ] 通常main push、該当SHA CI、Issue証拠を完了する。

- [ ] (Progress追加) 実LAN API更新後にprerelease v0.1.2-lan.1を作り、APK/ZIP/導入手順/ハッシュを添付。公開downloadを再取得してSHA256一致を確認する。

## Surprises & Discoveries

通常callbackは有効なflowでもOAuthError等をHTTP400 JSONへ変換し、既存LoginPageの回復導線へ到達しない。LoginPageはuser.dataがあるとerror表示より先にNavigateする。現在稼働LANはreading-v1で、新APK実機STはAPI更新前に開始しない。

## Decision Log

2026-10-12: 失敗redirectは設定済みDashboard originと、startで検証しstateへ保存したreturn_toだけを使う。callbackから追加されたURLやproviderの生メッセージを使わない。不正state/provider/期限/replay拒否、reauthと明示identity linkの境界を保つ。失敗時はuser/identity/WebSession/recent-auth/DeviceLinkを更新しない。再試行では新state/PKCEを使う。

2026-10-12: Android Chromeの初回規約は未承認。操作を保留し、Desktop Chrome・TestClient等の独立した検証を進める。Dockerのバックアップと復元試験は稼働サービスを止めずに準備する。実際の停止直前に親へ通知し、全WSLやOSを停止しない。

## Context and Work

apps/backend/wikimf/main.pyのoauth_callback、apps/dashboard/src/App.tsxのLoginPage、apps/backend/tests/test_auth_flow.pyのSuccessfulProviderが#30の入口。auth.py、ingest.py、projection.py、contracts.py、AndroidのApi/Storage/Reader/ControlOrder、拡張worker/outbox/contentとCompose/配布スクリプトのデータ所有者・停止・再送・版互換を確認する。

まず合成providerで取消とtoken/profile/identity失敗を再現し、既存DBのsnapshotが不変であることを確認する。回復画面の再試行リンクと既存ログインで続ける明示操作をDesktop Chromeで確認する。代表的な不正戻り先、複数flow、成功、reauth、identity linkの既存回帰を行う。再現しない設計好みの変更や新機能は追加しない。

## Validation and Recovery

ローカルPython/Node24と既存SDKを使う。PGの独立トランザクション回帰はCIと隔離環境で確認する。実Google/GitHubのstate/PKCE/signatureは合成providerで保証しない。Androidに影響する変更は専用emulator-5580のみで検証し、実機ADBと端末セキュリティ変更をしない。バックアップはC側の保護した一時領域、復元先は自分の隔離QAプロジェクトの新DBとし、元DBを変更しない。

## Outcomes & Retrospective

2026-10-12: #30は30件の追加回帰、Desktop ChromeとAndroid WebViewで確認。新しい#39は実WorkManagerの終了窓で10signalが0workになることを再現し、後続を一つに合流する修正後の実行成功を確認。Backend全173件は独立QAのPostgreSQLで成功、SQLite166成功/PG専用7skip。Tracker21件、拡張50件とビルド、Dashboardの既存26フローと追加OAuth回復ケースも成功。既存リモートとユーザー変更を保護し、実装と検証の結果をここへ更新する。旧CI署名鍵の制約、Chrome規約待ち、実機retry原因不明を残している。mainへのforce pushや秘密値のGit/Issue記録は行わない。


## Milestones and exact verification

レビュー対象はBackendの全7実装module、DashboardのApp/api/hooks/pagesと表示・format、AndroidのMainActivity/Api/Storage/RecordingControlOrder/BridgeGuard/URLと計測、拡張のworker/content/outbox/popup、共通trackerと生成契約、Composeと署名・配布・復元スクリプト。静的レビューと既存の代表回帰を組み合わせ、設計好みの変更はしない。今回の再現不具合は#30と#39、前工程の#37/#38である。全コードが無欠陥であることや実provider成功を意味しない。

repo rootから `python -m pytest apps/backend/tests -q`、`npm --prefix packages/tracker test`、`npm --prefix apps/extension test`、`npm --prefix apps/extension run build` を実行する。Dashboardは通常版previewを4173で起動し、DASHBOARD_URL=http://127.0.0.1:4173をテストプロセスに設定して `npm --prefix apps/dashboard test`、`npm --prefix apps/dashboard run build` を実行する。合成APIのブラウザ検証なので実OAuthとは別。

Androidは `apps/android/build.ps1 -Tasks @('testDebugUnitTest','testLanUnitTest','testLanLocalUnitTest','testReleaseUnitTest','assembleDebug','assembleLan','assembleLanLocal','assembleRelease','lintDebug','lintLan','lintLanLocal','lintRelease')`。すべて成功を確認する。実エミュレータ回帰はCIのclass指定と同じクラスをemulator-5580のみで実行する。OAuthRecoveryViewRegressionTestは `oauth_recovery_view=true` と4173の通常Dashboardがある場合だけ追加する。

更新検証は同一applicationId lanLocalのv5へ、v6 test APKだけを先に追加し、RetainedStateRegressionTestのretention_stage=seedで独立QA articleの未送信を作る。そのevent_idとpayloadハッシュを非公開ログへ保存し、v6本体を `adb -s emulator-5580 install -r` で上書きする。retention_stage=verifyは認証・履歴・設定・同一payloadを確認してキューを保持する。retention_stage=syncは10.0.2.2:18080のQA APIに限り明示的にクラウド同意をON、実送信ACKと同じpayloadのduplicateを確認し、同意をOFFへ戻す。このADBはユーザー実機には使わない。

PostgreSQLの全173件は自分のwikimf-feedback-qaのみでschemaをケースごとに分離する。production imageに含まれないscripts/backend_ops.pyはQAコンテナに検証用コピーする。TEST_DATABASE_URLをQAのdbに設定した後、テストプロセスだけからDATABASE_NAMEを外し、DB名既定値のテストがLAN環境を引き継がないようにする。元APIの環境変数やDBは変更しない。

バックアップは `.tmp/maintenance-20261012-dad6dc7850` にユーザーSIDとSYSTEMだけのACLで保存し、readonly REPEATABLE READのexported snapshotを使ってpg_dumpと全テーブルの行数・内容ハッシュを一致させた。独立QAの新しいbackup_verify_* DBへ復元し一致、設定の前後SHA一致、ログイントークンファイルの消費済み状態（不存在）を保護した。dumpは65,664bytes。圧縮直前に元DB/設定との差分を再確認し、変更があれば取り直す。実停止直前に親へ結果を返す。失敗時は元サービスを止めず、保護済みバックアップを保持する。

## Additional decisions

2026-10-12: versionCodeを5から6へ増やす。ローカル既存鍵の証明書4ccaa93feab14719472bb0bf42707e79027b8ec16f88aef576cf4ac8b8612519を固定して検証する。ユーザー配布は現在reading-v1の実LAN API更新後。停止前の通知、Chrome規約回答待ち、#32原因未確定を維持する。


2026-10-12: Chrome規約はユーザーのリンク付き承認を受けて保留解除。Manageで使用状況・クラッシュ送信OFFを確認し、Use without an accountで同意した。Android Chrome124のnativeフォームOrigin、正常login、token再利用拒否、Overviewの手動3状態と時間/文字数不変、既存セッションOAuth回復UIが成功。これは実Google/GitHub provider認証の成功ではない。Androidの最終20回帰も専用emulatorで成功。

2026-10-12: GitHub ReleasesでLAN検証用prereleaseとAPK/拡張ZIPの公開が追加承認された。通常拡張buildはprivate HTTPを拒否するため、明示WIKIMF_LAN_TEST_MODE=1の場合だけ単一private IPv4 HTTP originを許可する配布buildを追加。実manifest/設定/拒否先を検証する1テストを加え、拡張51unitと実Chromeの既存9smoke/12queue recoveryが成功した。ZIPは11ファイルallowlistだけ。API_ORIGINとDASHBOARD_ORIGINを192.168.11.10:8080へ固定し、ルーター公開・秘密値を含めない。公開repo確認と既存Git helperのpush権限を読取確認した。公開は実LAN APIのreading-v2更新・互換確認後。GitHubの公開APIを既存Git認証で使用し、新しい資格情報を作成しない。


