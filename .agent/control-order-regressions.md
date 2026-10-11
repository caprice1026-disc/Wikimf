# 収集制御の応答競合と接続・停止設定の回帰を修正する

このExecPlanはリポジトリルートの `PLANS.md` に従う生きた文書である。各段階で Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を更新する。今回の承認はコード修正、検証と最新ST署名APKからの実環境受入準備である。過去の計画に記録されたpushやIssue変更の承認は今回の公開承認として扱わない。

## Purpose / Big Picture

Dashboardで収集を止めたり履歴を削除した後、遅れて届いた古い応答によって記録や記事URL送信が再開しないようにする。AndroidとChromeが同じ利用者・端末の新しい制御を維持し、削除後の新しい記録を失わないことを確認する。統計アクセスが集中してもDB接続を待ち合って失敗せず、Chromeの停止中の送信希望と「同期して連携解除」が表示どおり動く状態にする。

修正後の自動検証と署名鍵・端末・HTTPS/OAuthの準備を分け、最新ソースから作ったことを確認できるST用APKだけを実環境受入へ進める。旧APKや模擬試験を新しい実機合格として扱わない。ユーザーのHTTPS未準備の回答により、今回の納品はコード・テスト・文書までとし、署名・実環境受入を保留する。

## Progress

- [x] (2026-10-11 09:43Z) remote mainを再取得し `2803c7907ae9de7b769f77def2a4aad21086f121` と照合した。独立checkoutと修正branchを用意した。
- [x] (2026-10-11 09:44Z) AGENTS.md、PLANS.md、既存検証記録、CI、署名とST手順を確認し、変更対象をChrome・Android・Backend・文書に限定した。
- [x] (2026-10-11 10:00Z) Chromeの制御・status・queue・送信直前の世代を修正し、保持設定と複数batch解除を確認した。extension50件/tracker17件、build、元の全再現probeが成功。実Chromiumはsocket EPERMで未実行。
- [x] (2026-10-11 09:59Z) Android共有制御順序と所有者・取消境界を修正し、focused JVM36件が成功。製品Api/SyncEngine、実OkHttpを使い、Android境界はdouble。Native/Gradle/署名APKは未実行と明記し、新しいNative classをCIへ追加した。
- [x] (2026-10-11 09:50Z) Backendの1接続snapshotとexport lockを修正。PostgreSQL16.2有効suite121件、SQLite114件（PG7件skip）、15並行stats全200/0.093秒、dump/restore復旧と性能検証が成功した。
- [x] (2026-10-11 09:51Z) 永続的な設計・受入文書と「最大5分」の記述を更新した。旧APKの注意と追加検証記録への導線を追加し、Markdown相対リンク193件が存在することを確認した。
- [x] (2026-10-11 10:00Z) 利用可能な全検証を完了し、実装をlocal commit `8a2ca25d43492a56b1742370989855b1f9f1b1dc` に保存した。review可能なformat-patchを作成した。続く文書のみcommitはこの実装SHAへ検証結果を固定する。公開・pushは未実施。
- [x] (2026-10-11 09:46Z) 現環境にST鍵・Gradle/SDK/adb/PowerShellがないことを値の露出なしで確認した。ユーザーはHTTPS接続先が未準備と回答したため、署名APKと実機受入は環境準備後へ保留する。今回の成果物をコード・テスト・文書とする。

## Surprises & Discoveries

認証で確保した接続を保持したまま投影専用接続を取得すると、既定のpool容量15に対する認証済み15リクエストが互いに待つ。レビューでは30秒後に11件が500となった。pool増量だけでは根本原因が残る。

Chromeの `sendQueued` は記録ON時の送信可否と停止中の利用者の希望を兼ねており、popupの状態再描画によって希望がONへ戻る。解除時の同期は100件までの1batchだけだった。

既存ST鍵はWindowsの利用者とマシンに結び付いたDPAPI保護である。新しいcheckoutには鍵を含めない。既存署名identityの変更や新規鍵作成を作業の代用にしない。現環境の署名4変数・SDK/Gradle/adb/PowerShellは未設定/未導入である。ユーザーがHTTPS接続先は未準備と回答したため、環境を新設する作業は行わず、コード・テスト・文書の完成を優先する。

## Decision Log

2026-10-11: controlとはBackendから返る収集ON/OFF、履歴全削除の世代番号epoch、記事削除期限markerの組である。1つの応答として順序・所有者を確認してから適用する。古い応答を無視するだけでなく、URLやイベント送信直前の許可も再確認する。理由は確認から送信までの待機中にも停止・取消・別の応答が入るためである。

2026-10-11: 接続数を増やす変更ではなく、認証と読み取り投影のtransaction境界を修正する。書き込み側のuser lockとは、同じ利用者の取り込み・削除を直列化するDBロックであり、exportを含むその境界は保持する。SQLiteのexportはFOR UPDATEが効かないため、認証前の明示BEGINでraw eventと投影を同じsnapshotへ固定する。

2026-10-11: 本修正はスキーマや新機能を増やさない。既存の標準ライブラリ、SQLAlchemy、Kotlin coroutine、Chrome APIとtest runnerで実装する。公開・deploy・新しいOAuth設定は独立した承認と実環境が整うまで行わない。

## Outcomes & Retrospective

Backend修正と全suite・復旧・性能の再実行が成功した。独立レビューでSQLite exportのsnapshot欠落を見つけ、5競合すべてを失敗再現してから専用transaction境界で修正した。Chrome50件とAndroid focused JVM36件も成功した。独立レビューで見つかった遅延HTTP失敗・status書込みの競合、hidden document変更も修正と再現試験を行った。既存の修正記録は元の9件の通常経路を検証しているが、今回の並行応答と接続・停止希望の回帰は追加の受入条件とする。完了時に実行済み、失敗、未実行を分けて記録する。

## Context and Orientation

`apps/extension/src/worker.js` がChromeのcontrol、記事解決、未送信queueと設定を扱い、`popup.js` が停止希望を表示する。queueはAPIへ未送信の読書イベント、ACKはAPIの行ごとの受理応答である。`outbox.js` が1batchの大きさとACK後の除去を担当する。

`apps/android/app/src/main/java/org/wikimf/reader/Api.kt` がHTTPと同期、`Storage.kt` が共有SettingsとSQLiteのqueue、`MainActivity.kt` がReaderの画面状態とsessionを扱う。複数のApiインスタンスでも順序を共有する必要がある。sessionは1つの文章・読書開始時点からの計測単位である。

`apps/backend/wikimf/projection.py` がDB行を読み統計を再計算し、`main.py` と認証の依存関数がrequestのsessionを作る。snapshotは関連する複数SELECTが同じ時点のDB状態を見るためのtransactionである。PostgreSQLはREPEATABLE READ、SQLiteは明示BEGINを維持する。

## Plan of Work

最初の段階はChromeとAndroidそれぞれの共有順序境界を作る。古いONを保留、新しいOFFを適用、古い応答を返すという試験で、保存済みOFFが保持されURL POSTが0であることを確認する。削除markerとepochにも同じ試験を適用し、古い応答が現行queueを削除しないことを確認する。取消、別画面・別document、owner/device変更の待機中にも送信を抑える。

次の段階はBackendの接続所有とChromeの停止設定を修正する。Backendは小さいpoolでも認証済み読み取りが成功する実API試験を追加し、既存の読み取りsnapshot、削除、手動状態、exportの整合性を再実行する。Chromeは記録中に停止後送信をOFFへ選び、その後停止すると残りが保持されることを確認する。101件以上を持つ明示解除ではACK済みbatchを繰り返し、失敗・進捗なし・収集OFFで安全に中断する。

最後にREADME、各package README、ADR、受入matrix、Android検証案内、ST手順へ現行契約と検証結果への導線を追加する。過去のsource・件数は改変せず、旧 `87ad275` APKに今回の修正が入らない注意を配布入口へ追記する。鍵・build環境・端末が揃えば最新commitをbuildしてSHA-256と既存証明書を照合する。揃わなければ署名済みと称さず、再開に必要な条件と正確なコマンドを残す。

## Concrete Steps

repository rootで次を実行する。環境にない依存・サービスは成功扱いせず記録する。

    python scripts/generate_contracts.py --check
    python -m pytest -q -p no:cacheprovider
    npm --prefix packages/tracker test
    npm --prefix packages/tracker run build
    npm --prefix apps/extension test
    npm --prefix apps/extension run build
    npm --prefix apps/dashboard ci
    npm --prefix apps/dashboard run test:unit
    npm --prefix apps/dashboard run build

Androidの標準検証は `apps/android` でJDK17、Gradle8.9、SDK35を用いて次を実行する。既存ST鍵を使うrelease手順は `apps/android/build.ps1 -StagingRelease` である。署名値をコマンド履歴・ログへ出さない。

    gradle testDebugUnitTest assembleDebug lintDebug --no-daemon
    gradle connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=org.wikimf.reader.ApiTransportRegressionTest,org.wikimf.reader.ReaderLifecycleRegressionTest,org.wikimf.reader.PrivacyRegressionTest --no-daemon

## Validation and Acceptance

controlの古い応答を返した後でも最新のOFF・epoch・markerが変わらず、禁止された記事URLとbatchが送られない。新しいepochで作ったqueue行は残る。記事削除はcutoffを厳密に過ぎてから、次の制御更新と記事解決・画面条件が揃った時点で新sessionを開始する。5分を再開の上限とはしない。

Backendは認証済み並行statsで接続待ち500を起こさず、投影中のingest/deleteでも単一snapshotの内容を返す。exportのロックと書き込みtransactionを保つ。Chromeの停止希望OFFが記録ON中にも保存され、停止後の自動送信は止まる。明示同期解除は複数batchを安全に処理し、未送信が残る失敗では連携を保持する。

実機受入には最新sourceのST署名APK、既存証明書digest一致、実HTTPS API/Dashboard、OAuth登録、接続されたAndroidが必要である。実OAuth・実端末でのKeystoreと回線切替、3〜7日利用はunit/VM試験で代用しない。

## Idempotence and Recovery

変更は独立branchへcommitし、未送信データを持つアプリのuninstallや既存鍵の上書きをしない。テストは合成データと隔離DBで繰り返す。失敗した解除ではACK済み以外のqueueと連携を保持する。新しいsourceから再buildする時は前のAPKを別名で保持し、署名とhashを必ず照合する。

## Artifacts and Notes

比較元は `2803c7907ae9de7b769f77def2a4aad21086f121`。修正・検証記録を `docs/releases/control-order-regressions.md` に作成し、local commitとpatch、実行コマンドと集計、未実行理由を引き渡す。APKは作成と署名検証が成立した場合だけ成果物に加える。

## Interfaces and Dependencies

HTTP API/eventの既存shapeとschema versionを維持する。Chromeのcontrol適用とAndroidのSettings共有境界に順序を保持し、owner/device/API切替を隔離する。Backendの投影の公開インターフェースと戻り値は維持する。追加の製品依存は不要である。

更新記録: 2026-10-11、独立レビューで再現された制御競合、接続枯渇、停止設定の回帰に限定した修正・検証計画を作成した。同日10:00Z、最終テスト、local実装commitと未実行の署名/実環境境界を反映した。
