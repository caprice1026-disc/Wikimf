# Android 実機と PC の LAN 同期確認を準備する

この ExecPlan はリポジトリルートの `PLANS.md` に従う living document である。Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を作業中に更新する。

## Purpose / Big Picture

同じ Wi-Fi にある Android 実機から PC の PostgreSQL/API/Dashboard に接続し、閲覧記録の同期、再送、二重計上防止、記録停止を確認できるようにする。通常の署名済み 0.1.1 APK と併存する LAN 専用 APK を直接インストールする。実 OAuth と本番 HTTPS の検証は別に行う。

## Progress

- [x] (2026-10-12) 指定 checkout `C:/Users/81905/Downloads/div/Wikimf` は変更なし。remote/main は `1d3f7db389160ffb94cf2bc484b8dffcfdd34f4e`。`feat/lan-verification` を作成した。
- [x] (2026-10-12) AGENTS.md、PLANS.md、既存 .agent 計画、Compose、API 認証、Android URL 境界と CI を調査した。.agents/skills は存在しない。
- [x] (2026-10-12) LAN Compose、専用ユーザーの一度限りのログイン、別 applicationId の APK、日本語手順を実装した。
- [x] (2026-10-12) Backend 128成功/PG専用7skip、LAN14成功、tracker17/extension50成功、Dashboard unit/build成功。Android debug/LAN/release unit/build/lint と実 APK の署名・manifest 境界が成功。Compose config と PowerShell 構文が成功。
- [ ] Compose 実起動と PostgreSQL 検証を CI で実行する。PC は Docker engine の Bad response / internal ping EOF で阻害されており、OS/WSL/security 設定は変更していない。
- [ ] 作業ブランチへコミット・push し、同一 commit の CI と APK 成果物を確認する。

## Surprises & Discoveries

PC は Windows `DESKTOP-O3UJGGG`、既存 checkout は Downloads/div 配下である。Wi-Fi は Private、IPv4 は `192.168.11.10/24`。Docker 23.0.5 / Compose 2.17.3 はあるが開始時点でデーモンが未起動。Node 18 / Python 3.10 はあるが Android SDK/JDK は未検出だった。既存 firewall の完全な一覧読み取りは権限不足である。

## Decision Log

2026-10-12: 既存 compose.yaml と独立した compose.lan.yaml を用いる。古い Compose の配列マージを避け、DB/API のポートを一切 publish せず、gateway の TCP 8080 だけを明示したプライベート IPv4 に bind する。LAN データは専用 PostgreSQL DB と volume に分離する。

2026-10-12: 本番の main.py へログイン bypass を追加しない。専用 `wikimf.lan` factory と CLI の両方で ENVIRONMENT=lan、LAN_TEST_MODE=1、RFC1918/loopback の同一 HTTP origin、専用 DB 名を要求する。CLI が作る高エントロピーの一度限りのログイントークンを POST 本文で交換する。ユーザーが Dashboard で収集同意し、既存の端末コード承認と exchange を使う。

2026-10-12: Android は新 buildType lan、applicationId `org.wikimf.reader.lan`、アプリ名 `wikimf LAN 検証`。非 debug とし、検証用の署名鍵を使う。LAN の HTTP は数値の RFC1918 IPv4 のみに限定し、通常 release は HTTPS のみ、debug の既存 loopback 例外は維持する。cleartext network 設定は lan source set に閉じ込める。

2026-10-12: Firewall の実変更、ルーター操作、ADB と端末設定変更は行わない。必要なら親へ TCP8080 / Private / 192.168.11.0/24 を候補として報告する。main は merge しない。

## Outcomes & Retrospective

承認済み構成と日本語手順を実装し、LAN APK をローカル作成した。初期の PowerShell 文字列配列で設定が1行になった問題を実行検証で発見し、括弧を付けて4行へ修正した。再発行ログインで収集 OFF が維持され、通常のコード承認と duplicate/停止拒否を確認した。ローカルの単体テストと build/lint が成功した。Docker engine 不調のため実 stack は CI で検証する。実端末の操作はユーザー自身の直接インストールとブラウザー連携で確認する。

## Context and Orientation

`apps/backend/wikimf/main.py` は通常 OAuth と端末認証、収集制御、イベント受領、集計を提供する。`apps/backend/wikimf/lan.py` は LAN 専用起動と一時ログインを担当する。端末コード承認は `/api/v1/device-links` と既存 Dashboard の `/link-device/<id>` で行う。Android の `Api.kt` は送信先、`DashboardUrls.kt` は管理画面と端末連携 URL を検証する。gateway は build 済み Dashboard を配信し `/api` と `/health` と `/lan-login` を内部 API に中継する。ACK はサーバーによるイベントごとの受領結果であり、同じイベント再送時は duplicate となる。

## Plan of Work

第一段階で独立 Compose と gateway Dockerfile/nginx 設定を作り、既存 API の稼働経路を変えず LAN factory と専用ユーザー準備 CLI を追加する。ログイン後の収集同意、CSRF、端末リンク、イベント schema は既存 API を使う。第二段階で Android lan variant と共通 URL policy の LAN opt-in を追加し、release の HTTP 拒否を回帰テストする。第三段階で起動・ログイン PowerShell と日本語実機手順、使い捨て CI stack を検証する Python script を整備する。CI は作業ブランチ push で実行し、LAN APK を artifact に保存する。

## Concrete Steps

すべてリポジトリルートから実行する。Python は依存をインストールした隔離 .venv、Node は 24、Android は既存 bootstrap/build.ps1 に従い JDK17/Gradle8.9/SDK35 を使う。

    python -m pip install -r apps/backend/requirements.lock
    python scripts/generate_contracts.py --check
    python -m pytest -q -p no:cacheprovider
    npm --prefix packages/tracker test
    npm --prefix packages/tracker run build
    npm --prefix apps/extension test
    npm --prefix apps/extension run build
    npm --prefix apps/dashboard ci
    npm --prefix apps/dashboard run test:unit
    npm --prefix apps/dashboard run build
    & ./apps/android/build.ps1 -Tasks @('testDebugUnitTest','testLanUnitTest','assembleLan','lintLan','assembleRelease','lintRelease')
    powershell -File scripts/lan.ps1 Init -BindIP 192.168.11.10
    powershell -File scripts/lan.ps1 Up
    powershell -File scripts/lan.ps1 Login
    python scripts/verify_lan_stack.py

## Validation and Acceptance

gateway で `/health` が 200、`/api/v1/config` が同じ入口を返し、`/app/settings/privacy` を直接開いて Dashboard が表示される。Compose config に公開ポートが gateway 一つしかない。通常 factory に `/lan-login` がなく、production で LAN opt-in は起動に失敗する。期限切れ、再利用、異 origin のトークン交換は拒否される。端末リンクは通常のコード承認で成功し、同じイベントを再送して active_ms が増えず、収集 OFF 後のイベントは受理されない。LAN APK は別 ID で署名済み、通常 release は非 debug / cleartext=false を維持する。

実機では 30 秒程度の閲覧、Wi-Fi を一時停止した閲覧と復帰、再同期、Dashboard の収集停止を確認する。これらを実施するまで実機合格とは称しない。

## Idempotence and Recovery

Init は既存 .env.lan を上書きしない。Login は同じ専用ユーザーに期限 15 分の新トークンを発行し、以前の未使用トークンだけ失効させる。Down は DB volume を残す。検証は専用 CI Compose project と専用 DB のみで行う。ユーザーの署名済み版を削除せず、release 鍵を触らない。ログイントークンと環境ファイルは git/docker context から除外する。

## Artifacts and Notes

主な利用手順は `docs/releases/android-lan-verification.md`。テスト結果、CI URL、APK SHA-256 は検証後に同文書と証拠ファイルへ記録する。ファイアウォール候補は TCP8080、Private、接続元 192.168.11.0/24。現在の規則の詳細は完全に取得できていない。

## Interfaces and Dependencies

新しい本番依存や DB migration は不要。FastAPI/SQLAlchemy/stdlib と既存 nginx/Node build を使う。LAN 起動は `uvicorn wikimf.lan:create_lan_app --factory`、トークン発行は `python -m wikimf.lan --prepare`。Android `ApiUrls.validBase(raw, debug, lan)` と `DashboardUrls` は既存呼び出しに LAN flag を加え、URL の資格情報・query・fragment を拒否する。

更新記録: 2026-10-12、既存 checkout 調査と承認済み LAN 構成を自己完結する計画にした。

更新記録: 2026-10-12、実装、ローカル回帰テスト、APK と release 境界、Docker 起動の阻害要因を反映した。
