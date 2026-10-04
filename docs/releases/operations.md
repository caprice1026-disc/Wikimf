# 閉じたMVP-Aの起動・復旧・配布

2026-10-04。対象は0.1.0、schema 1、reading-v1、prose-v1。一般公開の設定と実環境の受入は [ST計画](ST-plan.md) で行う。

## 配備と秘密情報

Python 3.13 / PostgreSQL 17.6、Node 24（ローカルは22.14でも確認）、Android JDK17 / Gradle8.9 / SDK35を使用する。APIとDashboardは同じHTTPS originの `/api/v1` とSPAとして配備する。Web CookieはSameSite=Laxなので、別originでも同じsite配下に置く。両方をHTTPSにし、`DASHBOARD_ORIGIN` をCORS許可元へ正確に設定する。Dashboardの直リンクは `index.html` へfallbackし、APIエラーをSPAへ転送しない。

`.env.example` をもとに運用者が `ENVIRONMENT=production`、`API_ORIGIN`、`DASHBOARD_ORIGIN`、独立した十分長い `SESSION_SECRET`、DBパスワード、Google/GitHub client ID/secretを用意する。値はGit・Issue・配布物へ含めない。provider callbackは `/api/v1/auth/{provider}/callback`。DashboardのAPIは同originなら既定 `/api/v1`、別originならbuild時の `VITE_API_BASE_URL` で指定する。拡張は `WIKIMF_API_ORIGIN` と `WIKIMF_DASHBOARD_ORIGIN` を指定して再buildする。AndroidのAccountでHTTPS API URLを設定する。

TLS proxyでHTTPS、HSTS、集約rate limit、最大request bodyを設定する。個人API・公開プロフィール・認証応答はcacheしない。proxy/access logへquery、本文、Cookie、Authorizationを残さない。現行APIのrate limitはprocess単位なので、複数workerの上限はproxy側で揃える。コンテナDBのポートはloopbackに限定している。

まず保持データのbackupを取り、依存をlockファイルから導入して `alembic upgrade head` を実行する。`GET /health` のschema/policyとmigration head、Dashboard、端末連携、観測ACK、非公開APIの認証を確認してから利用を開始する。migrationのdowngradeは空の隔離DBでのみ確認済み。保持データのある本番DBをdowngradeする手順にはせず、旧版への復帰はbackupと安全台帳で行う。

`0004_auth_boundaries` では5分有効の連携待ち要求を破棄し、確認コードをsalt付きhash保存へ変更する。更新中の端末連携は最初からやり直す。既存sessionは読み取りを継続できるが、重要操作には既存providerで本人確認を行う。連携済み端末や読書履歴は移行で削除しない。APIとDashboardを同時に更新し、期限切れの403から本人確認へ進めることを確認する。

## 保持と停止

閉じた検証中はraw event、正規化interval、判定根拠を本人削除まで保持する。端末Outboxは7日、Android 10 MiB / Chrome 8 MiB。上限・期限による保留や破棄を画面で確認する。検索の途中入力、本文、キー入力、Cookie、外部referrerは送信しない。

`backend_ops.py cleanup` は期限切れWeb session/grantの対象数を表示する。`--apply` で削除する。削除markerをqueueの7日だけで消すことはせず、それ以前のbackupがすべて期限切れになってから扱う。閉じた検証のbackupは暗号化した別保管先へ日次取得し、14日を上限とする運用方針。暗号化・期限削除・継続取得の環境設定はSTで確認する。正式公開用のraw event圧縮・保持期限もSTで確定する。

クラウド停止は新たな受理を止め、端末停止はその端末だけを止める。記事削除は許容clock skewの5分をcutoffへ加えるため、その記事の記録再開まで最大5分待つ。全消去はepochを進め、旧queueを直ちに拒否する。記録は理解度の保証ではなく、idle60秒・非focus・2秒超tick gap・未表示本文による過小評価がある。

## Backupと復元

削除・失効を反映した最新台帳をbackup volumeとは別の暗号化保管先で維持する。台帳v2はuser UUID/epoch、marker、manual state、存続identity UUIDを含み、provider subjectやtokenは含まない。機密の管理データとしてアクセスを制限する。台帳を公開リポジトリへ置かない。

planned restoreの前にAPIと端末の同期を停止し、現在DBから最新台帳をexportする。障害で現在DBを読めない場合は、別保管台帳が最後の削除・identity解除以降の状態だと確認できることを前提とする。鮮度を確認できない古い台帳でサービスを再公開しない。定期backupがあるだけでは削除復活防止を満たさない。

以下はPowerShellの例。backup/台帳は既存データを上書きしない新しい保存先へ指定する。接続パスワードは安全なPG設定から与える。

```powershell
$env:DATABASE_URL='postgresql+psycopg://wikimf@127.0.0.1:54329/wikimf'
.venv\Scripts\python.exe scripts/backend_ops.py export-safety --file D:\secure\latest-safety.json
pg_dump -h 127.0.0.1 -p 54329 -U wikimf -Fc -f D:\secure\backup-20261004.dump wikimf
# API停止のまま、別の空DB wikimf_restored へ復元する。
pg_restore -h 127.0.0.1 -p 54329 -U wikimf --exit-on-error -d wikimf_restored D:\secure\backup-20261004.dump
$env:DATABASE_URL='postgresql+psycopg://wikimf@127.0.0.1:54329/wikimf_restored'
.venv\Scripts\python.exe -m alembic -c apps/backend/alembic.ini upgrade head
.venv\Scripts\python.exe scripts/backend_ops.py apply-safety --file D:\secure\latest-safety.json --apply
.venv\Scripts\python.exe scripts/backend_ops.py rebuild
```

`apply-safety` は旧Web session/grantを削除し、端末tokenを全失効する。最新台帳にないuser/identity、旧epoch履歴、削除記事、解除済みmanual stateを復活させず、収集・公開をOFFにする。backupにない記事のmarker/manual stateは追加しない。現行Userロックとtransactionで適用し、本人の再ログイン・再連携・再同意を待つ。処理が失敗したDBはAPIへ接続せず、失敗理由を解決して再実行する。

実行済みの復旧ドリルは `python scripts/verify_recovery.py`。専用のUUID付きDBだけを作成し、空DB migration往復、raw/manual/identityを保持した0002→0004 upgrade、連携待ちコードの消去、既存sessionの本人確認要求、実 `pg_dump` / `pg_restore`、記事/全履歴/アカウント削除、identity解除、バックアップ後の記事参照、旧token/session失効を確認する。保持データでのdowngradeはこの使い捨てfixtureだけに限定し、既存DB・volumeを消さない。

`rebuild` はraw evidenceから同じ関数で二回再計算し、一致と隔離件数を報告する。現行は画面表示時にも同じreplayを使うため、別projection表を作らない。500 eventsのローカルPG計測は [検証記録](verification.md) を参照する。

## 配布と更新

M10時点の閉じた検証用セットはAndroidのdebug APK、Chromeのunpacked extension、Dashboardのstatic buildである。Chromeの実デバッグでは専用profileとDevTools `Extensions.loadUnpacked` を使用した。利用者の既存profileは変更していない。正式公開用の鍵・最終application ID・Chrome Store登録はSTで準備する。

Androidの実機STは、エミュレーターで機能を確認した後にST専用署名のrelease APKへ進む。実機1台の縦断・固有挙動を確認し、3〜7日普段使いする。debug APKの成功だけをrelease版の受入にせず、正式公開用鍵とST鍵を分離する。具体的な6段階と判定は [ST計画](ST-plan.md)、ビルドとインストールは [実機ST手順](android-device-ST.md) に従う。

検証済みsourceをcommitしてから三つをbuildし、`python scripts/package_release.py` で `dist/0.1.0-<commit>/` にまとめる。manifestにはversion/schema/policy/extractor/source SHAと各artifactのSHA256を保存する。ZIP/APKはGitへ混ぜず、ソースと再現手順をmainで管理する。更新時はAPI契約・migration・policyの互換性を確認し、schema/policy変更を無言で過去記録へ適用しない。

## 実Wikipediaの記事情報を使うローカル検証

通常の `scripts/local_smoke_server.py` は合成identityと合成metadataを使う。実Wikipediaのmetadataを確認する場合は、別DB `wikimf_live_smoke` を作りmigrationを適用してから、`SMOKE_LIVE_WIKIPEDIA=1` で同じスクリプトを起動する。このモードは実MediaWikiClientを使用し、合成記事や読書イベントを作らない。実OAuthを通らない合成QA identityだけを用意する。接続先はlocalhost/127.0.0.1:54329の同名PostgreSQLへ制限し、SQLite、外部host、別port/DBを接続前に拒否する。

```powershell
createdb -h 127.0.0.1 -p 54329 -U wikimf wikimf_live_smoke
$env:DATABASE_URL='postgresql+psycopg://wikimf@127.0.0.1:54329/wikimf_live_smoke'
.venv\Scripts\python.exe -m alembic -c apps/backend/alembic.ini upgrade head
$env:SMOKE_LIVE_WIKIPEDIA='1'
.venv\Scripts\python.exe scripts/local_smoke_server.py
```

既存DBがある場合は作り直さず状態を確認する。APIは `localhost:8002`、debugエミュレーターからは `10.0.2.2:8002/api/v1`。別のPowerShellで `WIKIMF_API_PROXY=http://127.0.0.1:8002` を設定し、`npm.cmd --prefix apps/dashboard run dev -- --port 5174 --strictPort` でDashboardを起動する。認証情報はignored `.tmp/backend-live-smoke.json` に保存し、ログや証跡へ貼らない。実機用HTTPSサーバとして公開しない。

Androidを専用QA identityへ明示的に連携し、実日英記事を各10秒以上記録した後、`node apps/dashboard/scripts/android-live-smoke.mjs` で実Chromeから照合する。実測のない記事をテストデータで埋めない。既存の端末連携・未送信データは保持し、API変更による資格情報消去を理解した隔離環境で実施する。
