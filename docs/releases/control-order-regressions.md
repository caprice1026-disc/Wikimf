# 収集制御の応答競合・接続・停止設定の追加修正

2026-10-11。比較元は `2803c7907ae9de7b769f77def2a4aad21086f121`。[#19〜#27の通常経路の修正](issue-fixes-19-27.md) 後、独立レビューで再現した残件を対象にする。検証した実装commitは `8a2ca25d43492a56b1742370989855b1f9f1b1dc`。集計は [機械可読の検証記録](evidence/control-order-validation.json) に保存する。現在の成果物はコード・回帰テスト・文書であり、新しいST署名APKと実環境受入は未実施。ユーザーはHTTPS接続先がまだ未準備と回答した。

## 対象と実装

### #19: 認証用接続を保持したままsnapshot用接続を待つ

投影を行うGETは認証前から固定snapshotを開始し、同じSQLAlchemy Session・接続で認証と関連SELECTを実行する。PostgreSQLはREPEATABLE READ、SQLiteは明示BEGIN。replay自身は追加接続、commit、rollbackを行わない。pool容量は増やさない。

PostgreSQLのexportと運用rebuildは既存のREAD COMMITTED transactionでUser行ロックを保持してreplayする。SQLiteのexportは認証前に明示BEGINし、投影とraw eventsを同じsnapshotで読む。同じ利用者の取り込み・削除・設定変更がそのロックに従うため、ロックを途中で解放しない。手動state更新は書き込みcommit後にsnapshotを開始して読み戻す。

### #20/#23: 古い収集control応答が新しい状態を上書きする

ChromeとAndroidはそれぞれ端末内でcontrolの要求順序とowner/deviceへの束縛を共有する。HTTP APIは変更せずserver snapshot revisionを持たないため、この順序はクライアントが開始した要求の世代で管理する。新しい要求に追い越された応答を、queueのpruneや設定保存より前に拒否する。epochの逆行を拒否し、同じ所有者の削除cutoffを後退させない。端末連携やAPI接続先の変更では古い要求を無効にする。

ResolverへのURL送信とイベントbatchは現在有効な制御と許可を再確認する。待機中の停止、連携変更、取消や新しい画面・documentから古い処理が復活しないようにする。削除後の同一記事は旧sessionを終了し、cutoffを厳密に過ぎてから、制御更新・記事解決とReaderの計測条件が揃った時点で新sessionを開始する。

cutoffはサーバー時刻+5分であり、再開までの最大時間ではない。Chromeの通常poll、ネットワーク、非表示状態やAndroidの画面状態によって再開は遅れる。

### #21: 停止後の送信希望と複数batchの解除

Chromeの「停止中も保存済みの記録を同期する」は現在の記録ON/OFFと独立して保存する。記録中に希望をOFFにしても記録中の通常同期は継続し、後で停止した時は未送信を保持する。popupは保存した希望を表示する。

「同期して連携解除」はACK済みbatchを順に処理する。収集OFF、所有者変更、通信失敗、ACKによる進捗なし、初期queue件数に基づく回数上限または120秒の開始判定期限では中断し、残りのqueueと連携を保持する。通常の明示同期は1回の操作だけ自動送信OFFを上書きし、収集同意・端末失効を上書きしない。

## 検証結果

以下は今回の修正sourceで実行した検証である。unit/VM、実HTTP、PostgreSQL、Native/実ブラウザを区別し、skipや未実行を成功へ含めない。

- PostgreSQL 16.2を有効にしたBackend全suite: 121件成功、skip0（うち5件は明示的にSQLiteでexportを検証）。新規の1接続poolと認証済み同時読み取り、exportロック・隔離境界、既存の投影snapshot/削除/手動状態を含む。
- SQLiteのみのBackend全suite: 114件成功、PostgreSQL専用7件skip。追加レビューでexportのSQLite snapshot欠落を検出し、5競合を失敗再現してから修正。raw eventsと投影を含むexport全体が変更前snapshotと一致する。
- レビューと同じ15件の認証済みstats同時実行: 修正前は既定30秒timeoutで11件500、修正後は15件すべて200、0.093秒。pool容量は既定のまま。
- 新しいpool回帰を比較元へ適用すると、9件が接続timeoutで失敗した。手動state読み戻しは比較元でも成功する対照ケース。
- 契約schema再生成check、tracker17件とbuild、Dashboard日時unit/TypeScript/production build: 成功。
- 実 `pg_dump` / `pg_restore` を含む復旧ドリル: 成功。記事/全履歴/アカウント削除、identity解除、古い認証の復活防止、migration往復を確認。
- 500イベント・各endpoint30 requestの性能確認: stats p95 102.85ms、全endpointが目標p95 500ms以内。in-process HTTPと実PostgreSQLであり、TLS/WAN負荷試験ではない。
- Chromeの独立再現probeを比較元→修正後で再実行: 古いON応答でOFF→ON/URL送信1回となる経路が、OFF保持/URL送信0回へ変化。削除markerは1件を保持しcutoff中leaseを拒否。epoch2のqueue行は消えずloss0/epoch2を保持。
- Chromeの101件解除: 比較元は100件だけ送信して残り1件と連携が残ったが、修正後は100+1件のACK後にqueue0/解除完了。記録中に停止後の送信希望をOFFへ選び、その後停止すると残りを保持。control待機中の自動同期を停止しても送信0回。
- Chrome追加回帰suite: 50件成功、skip0。buildと変更した3sourceの構文検査も成功。製品contentの取消、pagehide/pageshow、古いstart、hidden中の本文変更と本文不変のsession維持も確認した。413分割と進んだepochで101件を処理する経路は100→50+50→1のACK後に解除する。
- Android追加回帰: focused JVMで製品Api/SyncEngineと順序制御をコンパイルし、通常JVM17件、Native用にcommitした制御競合7メソッド、独立HTTP2件、抽出Reader lifecycle10件の計36件が成功。古い成功・401/403・IOExceptionがdispatcher待機中に新制御へ追い越された場合も再確認した。Android/WorkManager/SQLite/資格情報境界はdoubleであり、Native実行の合格件数ではない。
- 独立したHTTP競合2件: 本文close前とcoroutine dispatcher待機中に新しいcontrolを適用し、古い401/403が新しい許可を無効化しないことを実OkHttpで確認。Chromeの遅延status書込みによる同種の上書きも修正し再現probeが成功。

AndroidのJVM検証はJDK21/Kotlin2.0.21を使用し、製品目標のJDK17/Gradle8.9/SDK35によるbuild/lint、実SQLite/Keystore/WebView、API35 instrumentationは今回未実行。新しい `RecordingControlRegressionTest` をCIの明示実行対象へ加えた。`ReaderLifecycleRegressionTest` の追加取消/破棄試験も実Nativeでは未実行。

Chromeの上記probeは製品worker/popup/content/trackerのVM実行で、実Chrome/MV3の確認ではない。実Chromiumはsocket作成のEPERMで起動できず、実ブラウザ確認は未実行。

今回のPostgreSQLは隔離した16.2であり、既存CIの17.6を今回再実行した証拠ではない。既存の復旧・性能スクリプトは出力に17.6という固定文字列を含むため、今回の記録は実際に起動した16.2へ訂正している。Dashboard buildは既存依存の `use client` directiveに関する警告を出すが成功した。

## ST署名APKと実環境受入の再開条件

現環境には既存ST署名鍵、4つの `WIKIMF_SIGNING_*` 設定、Android SDK/Gradle/adb/PowerShellがない。既存鍵は元のWindows環境のDPAPIで保護されている。鍵を作り直したり署名identityを変えて更新用APKを用意しない。秘密値をチャット・ログ・Gitへ移さない。

[既存APK manifest](evidence/android-st-artifact-manifest.json) のsource `87ad275e62ddba6a83d8467b0ab58e568bbad5ad` は#19〜#27と今回の修正を含まない。そのAPKを新しい修正の受入へ使わない。

1. 修正sourceをレビューし、公開が承認された場合はremoteの対象SHAとCI結果を照合する。今回のlocal testだけでremote CI成功とは書かない。
2. 既存ST鍵が使える元の署名環境で最新対象sourceをbuildする。`apps/android/build.ps1 -StagingRelease` を使い、debug/test APKとは分ける。
3. APKのsource SHA、SHA-256、bytes、証明書digest、署名検証、manifestのdebuggable/cleartext、tracker assetを記録する。既存ST証明書SHA-256 `ec08dcc593a05822dbd25d08a712de495b83e0d7fb7a433c1bbd50c56ecb1f84` と一致させる。
4. 実HTTPS API/Dashboardと必要なOAuth設定を用意し、実Android 1台を接続する。秘密値を確認記録へ載せない。元アプリの未送信がある場合は、署名不一致のために無断でuninstallしない。
5. [ST計画](ST-plan.md) と [実機手順](android-device-ST.md) に従い、実Wikipedia→API/PG→Dashboard、control応答競合・同意OFF・削除再開、Account/Search/実背景化、回線切替、Keystore、IME、3〜7日利用を確認する。

本記録の自動試験は、通常user OSでのWebView debugging無効、物理Keystore、実OAuth、実回線や継続利用の代替ではない。#13の実環境受入は未完のまま残す。

## 再実行の入口

repository rootから `python -m pytest -q -p no:cacheprovider`、`python scripts/generate_contracts.py --check`、`npm --prefix packages/tracker test`、`npm --prefix apps/extension test` と各buildを実行する。PG専用試験は隔離DBの `TEST_DATABASE_URL` を指定する。Dashboardは `npm --prefix apps/dashboard ci`、`run test:unit`、`run build`。復旧・性能は隔離DB権限を持つ環境で `python scripts/verify_recovery.py` と `python scripts/verify_performance.py` を使う。

Androidの正規確認は `.github/workflows/ci.yml` のJDK17/Gradle8.9/SDK35、`testDebugUnitTest assembleDebug lintDebug` とAPI35 Native対象4classの実行である。新しい `RecordingControlRegressionTest` と既存のHTTP/Reader/Privacy classを含む。今回のfocused JVMハーネス結果をこれらの未実行チェックへ置き換えない。
