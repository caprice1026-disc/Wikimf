# Issue #19〜#27 の読書記録・同期・配備不具合を修正する

この計画は `PLANS.md` に従って更新する。ユーザーは修正、検証、remote mainへのpush、解決したIssueのcloseを承認した。実OAuth・HTTPS・物理端末は未準備と回答しており、#4/#11/#12/#13の実環境受入は残す。

## Purpose / Big Picture

同期と統計閲覧が重なっても正常な統計を返し、収集停止中のChromeから記事URLを送らない。停止後の未送信同期、時計逆行、記事削除後の再開、Androidの本文変更・遅延HTTP応答・正規記事URLを修正する。特殊文字を含むDBパスワードでもmigrationとhealthを成功させる。回帰テストと実PostgreSQLで結果を確認できる状態にする。

## Progress

- [x] (2026-10-11) mainをcloneし、13件の未解決IssueとAGENTS.md/PLANS.mdを確認した。
- [x] (2026-10-11) ユーザーの回答によりコードで解決できる9件へ対象を確定した。
- [ ] Backend投影の一貫した読み取りとDB接続構成を修正・検証する。
- [ ] Chromeの送信前同意確認、明示同期、削除cutoffを修正・検証する。
- [ ] 共通trackerの時計逆行を修正・検証する。
- [ ] Androidの削除通知、非表示中の本文変更、HTTP本文処理、URL判定を修正・検証する。
- [ ] 統合チェック、main push、remote CIを確認し、解決Issueをcloseする。

## Surprises & Discoveries

既存コードは機能実装済みだが、実環境受入の親Issueを維持している。ローカルにはSDK/Gradleがなく、DockerとJDK21は利用可能。ネットワークを使うshellには追加network権限が必要。実端末確認をテスト結果と混同しない。

## Decision Log

2026-10-11 / Codex: 実OAuth・物理端末を要するIssueはcloseしない。理由はユーザーが環境未準備と回答したため。具体的な不具合9件は独立した回帰証拠を伴って解決する。

2026-10-11 / Codex: 投影は専用の読み取りtransactionで固定snapshotを使う。snapshotとは処理開始時点のDB内容を最後まで同じ状態で読む仕組み。PostgreSQLはREPEATABLE READ、SQLiteは明示BEGINを用い、ingest側のREAD COMMITTEDや削除防止のロックを変えない。

## Outcomes & Retrospective

調査を完了し、実装中。未実施の確認はここへ明記する。

## Context and Orientation

`apps/backend/wikimf/projection.py` は保存したイベント・session・時間区間から統計を再計算する。`db.py` はSQLAlchemy接続を生成する。`compose.yaml` はDBとAPIを起動する。`apps/extension/src/worker.js` はChromeの同意確認・記事解決・永続未送信キューを扱い、`content.js` は記事上で共通trackerを起動する。`packages/tracker/tracker.js` は壁時計と単調時計から有効時間を計測し、`android-adapter.js` はNativeへイベントと本文変更を通知する。Androidの `MainActivity.kt` にあるReaderControllerがNativeのsessionを管理し、`Storage.kt` に同意・削除制御を保持する。`Api.kt` はOkHttpのHTTP通信、`UrlPolicy.kt` は対象URLを判定する。

## Plan of Work

まず投影の複数SELECTが同じ時点の内容を使うようにし、別transactionから新規session・追記・削除を挿入するテストを追加する。DB接続はComposeから個別項目を渡し、URL.createでパスワードを安全に扱う。

Chromeは記事URL送信前に最新controlとローカル設定を確認する。明示syncだけsendQueued設定を上書きできるようにし、収集停止・失効は維持する。記事削除の期限中はleaseと開始を保留し、期限後の定期refreshで新sessionを開始する。

共通trackerは小さい時計逆行も検知し、最後の有効サンプルまで保存してsessionを終了する。Androidは削除markerを設定へ保持してReaderへ反映し、期限後に再開する。非表示中のdocument_changedでもNative contextを無効化する。HTTPは本文を読み切るまでキャンセル可能なOkHttp callbackで処理する。正規URLは共通契約と同じidentifier/action/重複判定を使う。

## Concrete Steps

作業ディレクトリはリポジトリroot。依存は `python -m venv .venv` と `.venv/bin/python -m pip install -r apps/backend/requirements.lock` で固定版を用意する。`npm --prefix packages/tracker test`、`npm --prefix apps/extension test` と両方の `run build` を実行する。Backendは `.venv/bin/python -m pytest -q -p no:cacheprovider` と `scripts/generate_contracts.py --check` を実行する。PostgreSQLは隔離したDockerコンテナを用意し、TEST_DATABASE_URLを指定して同じpytestを実行する。Composeも別project/volumeで検証し、既存volumeは削除しない。AndroidはローカルSDK/Gradleを用意できれば `gradle testDebugUnitTest assembleDebug lintDebug` を実行し、できなければremote CIで同じチェックを確認する。

## Validation and Acceptance

投影の途中で同期/削除がcommitしても読み取りは変更前か変更後の一貫した200を返す。収集停止またはcontrol失敗ではResolver/batchを呼ばない。明示同期は停止中の保持キューをACKまで送り、自動同期は送らない。記事削除後は旧sessionを破棄し、cutoffより後の新sessionのみ再開する。1〜2000ms逆行とflush境界でも観測が契約を満たす。Androidの非表示中に本文が変われば復帰時に新sessionへ移り、非表示時間は加算しない。HTTP遅延本文はMainで読まれずキャンセルできる。日英のindex.php/title/action=viewを許可し、競合identifier・edit・oldid・偽hostは拒否する。合成の@/%40パスワードでDB接続・migration・healthが成功する。

## Idempotence and Recovery

テストDB/schemaとDocker projectは本番から隔離する。失敗したテストは同じコマンドで再実行できる。mainへは通常のfast-forward pushのみ行い、競合時はfetchして差分を確認する。秘密値や実際の認証情報をログ/コミットへ含めない。Issueは検証結果とcommitがremoteに存在してからcloseする。

## Artifacts and Notes

検証結果は `docs/releases/issue-fixes-19-27.md` に記録する。各Issueへ対応commitと実行済み検証を示し、実Chrome/Android操作の未実施を明記する。

## Interfaces and Dependencies

既存のSQLAlchemy、OkHttp、kotlinx.coroutines、Node test runner、JUnitを使う。API schemaと削除拒否ルールは維持する。DB接続はDATABASE_URLによる既存の直接起動も維持する。追加ライブラリは必要最小限とする。

2026-10-11: 初版。調査とユーザー回答に基づいて対象と検証方法を確定した。
