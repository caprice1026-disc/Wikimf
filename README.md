# wikimf

Wikipedia の読書記録を、自分の非公開履歴・統計へまとめるサービスです。日本語・英語の本家記事を Android Reader と Chrome 拡張で読み、Dashboard で振り返ります。Wikipedia / Wikimedia Foundation とは独立した非公式サービスです。記事のライセンス・出典は本家の導線から確認してください。

読書状態は「閲覧」「途中まで読んだ」「読了」。表示された本文とアクティブ時間から推定するため、理解度の証明ではありません。手動設定では時間・推定文字数を増やしません。

M0〜M10の機能を実装し、PostgreSQL・実Chrome・Android15エミュレータで閉じた検証を行っています。一般公開前に必要な実OAuth、HTTPS配備、物理実機、署名と継続利用の確認は [ST計画](docs/releases/ST-plan.md) に残しています。

## 構成と仕様

| パス | 内容 |
|---|---|
| `apps/backend` | FastAPI / SQLAlchemy / PostgreSQL、認証、端末連携、観測受付、統計・削除 |
| `apps/android` | Kotlin / Compose / WebView、検索、永続Outbox、Keystore |
| `apps/extension` | Chrome Manifest V3、タブ調停、永続Outbox |
| `apps/dashboard` | React / TypeScript / Vite、履歴・統計・アカウント管理 |
| `packages/tracker` | 共通の本文抽出・時間・coverage計測 |
| `packages/contracts` | API契約とPydanticから生成するJSON Schema |
| `.agent/m0-m10.md` | 実行計画と判断記録 |

基準は [詳細設計](docs/wikimf-detailed-design-v0.1.md)、[実装計画](docs/wikimf-implementation-plan-v0.1.md)、[Dashboard設計](docs/wikimf-dashboard-ui-design-v0.1.md)。投稿、Neighbours、ゲームはMVP-A後の対象です。

## ローカル起動

ルートで実行します。Python 3.13、Node.js、PostgreSQL 17を使用します。Python依存は `requirements.lock`、フロント依存は各 `package-lock.json` で固定しています。

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r apps/backend/requirements.lock
Copy-Item .env.example .env
docker compose up -d db
$env:DATABASE_URL='postgresql+psycopg://wikimf:wikimf@127.0.0.1:54329/wikimf'
.venv\Scripts\python.exe -m alembic -c apps/backend/alembic.ini upgrade head
.venv\Scripts\python.exe -m uvicorn wikimf.main:app --app-dir apps/backend --host 127.0.0.1 --port 8000 --no-access-log
```

`GET http://localhost:8000/health` が `{"status":"ok",…}` を返せば起動確認は完了です。`.env` はComposeが読みます。Pythonを直接起動する場合は必要な設定を環境変数へ渡してください。Windowsのvenv/pipが一時領域ACLで失敗する場合は、既存pipの `python -m pip --python .venv\Scripts\python.exe install -r apps/backend/requirements.lock` を使えます。

Dockerが使えないWindowsでは `python scripts/prepare_postgres.py` で `.tooling/` にPostgreSQLを配置できます。`initdb` と `pg_ctl` で `127.0.0.1:54329` に起動してください。trust認証は隔離したローカル検証専用です。既存DBのvolume/dataは削除しないでください。

```powershell
npm.cmd --prefix apps/dashboard ci
npm.cmd --prefix apps/dashboard run dev
npm.cmd --prefix packages/tracker run build
npm.cmd --prefix apps/extension run build
python apps/android/bootstrap.py
powershell -ExecutionPolicy Bypass -File apps/android/build.ps1
```

Dashboardは `http://localhost:5173`。拡張は `chrome://extensions` の開発者モードで `apps/extension/dist` を読み込みます。AndroidにはJDK17/SDK35を使用します。詳しいインストール・更新・APKの場所は [Android手順](apps/android/README.md)、[拡張手順](apps/extension/README.md) を参照してください。

## 認証と記録の管理

Google/GitHubのOAuth登録、client ID/secret、接続先は運用者が設定します。callbackは `/api/v1/auth/google/callback` と `/api/v1/auth/github/callback`。provider secretはBackendだけに置きます。同じメールアドレスによる自動統合は行わず、別のログイン方法はログイン済みの設定から追加します。

Android/拡張は外部ブラウザで端末名・確認コードを承認し、一回限りのgrantから専用tokenを取得します。端末tokenで管理操作はできません。削除・公開設定・identity管理にはWeb sessionとCSRF検証が必要です。

AndroidのAPI接続先を変更すると端末連携とクラウド同意を解除します。再連携後に同意してください。旧Outboxは旧owner/deviceのまま保持し、新しい連携へ付け替えません。

ローカル履歴、クラウド記録、公開は別の同意です。初期はクラウドOFF・プロフィール非公開。端末の一時停止で他端末を止めません。既存の未送信記録は送信/破棄を選べます。キー入力内容、検索途中の語、Wikipedia本文、Cookie、外部referrerは収集しません。

再送は一回だけ計上し、複数端末の重複時間は和集合にします。記事削除は許容する時計のずれも含めて旧sessionを拒否するため、同記事の記録再開まで最大5分待ちます。全消去はepochを更新して古いOutboxを直ちに拒否します。推定文字数は記事別session最大値を使い、再読ごとに増やしません。

## 検証とリリース境界

```powershell
$env:TEST_DATABASE_URL=$env:DATABASE_URL
.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
.venv\Scripts\python.exe scripts/generate_contracts.py --check
npm.cmd --prefix packages/tracker test
npm.cmd --prefix apps/extension test
npm.cmd --prefix apps/dashboard run test:unit
npm.cmd --prefix apps/dashboard run build
.venv\Scripts\python.exe scripts/verify_recovery.py
.venv\Scripts\python.exe scripts/verify_performance.py
```

PGテストは専用schemaを使用します。`TEST_DATABASE_URL`未設定時はSQLiteで実行し、PG並行処理をskipします。skipを確認済みには数えません。`scripts/local_smoke_server.py` は合成アカウントを使うローカル検証専用で、公開しません。

復旧・性能スクリプトは隔離DB/schemaを作成できるローカル検証権限を必要とします。既存DBの保持データを削除しません。Chromeの実デバッグ、Androidの正の時間/coverage/ACK、同ユーザーDashboard表示、実pg_dump/pg_restoreを確認しています。合成provider/記事metadataを使った確認を実OAuthの成功とは数えません。

[検証結果・既知の制約](docs/releases/verification.md)、[70ケース受入台帳](docs/releases/acceptance-matrix.md)、[復旧・配布手順](docs/releases/operations.md) に結果を記録します。配布ビルドをcommitしたソースへ対応付けるには `python scripts/package_release.py` を実行します。出力は `dist/0.1.0-<commit>/` のdebug APK、拡張ZIP、Dashboard ZIP、SHA256付きmanifestです。
