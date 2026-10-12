# Android 実機の LAN 同期検証

この構成は信頼できる同じ Wi-Fi 上の PC と Android で同期だけを確認するための専用環境です。実 OAuth、公開 HTTPS、署名鍵の運用確認は別の試験です。通常の署名済み 0.1.1 アプリはそのまま残せます。

## 構成と範囲

`compose.lan.yaml` を単独で使います。PostgreSQL の DB 名は `wikimf_lan`、Compose project は `wikimf-lan` です。build 済み Dashboard と `/api/v1` は同じ入口で配信します。公開するのは PC のプライベート IPv4 の TCP 8080 一つだけです。DB の 5432 と API の 8000 はコンテナー内だけで使います。既存 `compose.yaml` と混ぜないでください。

LAN APK は `org.wikimf.reader.lan`、アプリ名は **wikimf LAN 検証**、version は `0.1.1-lan` です。検証用鍵で署名する非 debug 版です。HTTP は数値の RFC1918 IPv4（192.168.x.x / 10.x.x.x / 172.16–31.x.x）だけをアプリで許可します。通常 release の HTTPS 制限は維持します。署名済み本番版の更新には使いません。CI の検証鍵は実行ごとに生成され、PC の隔離検証鍵とも異なります。鍵が異なる別の LAN APK で更新できない場合、先に LAN 版のローカル履歴を確認・退避してから LAN 版だけを扱ってください。

テストログインは `ENVIRONMENT=lan` と `LAN_TEST_MODE=1` の専用 factory でだけ存在します。通常 API の起動経路にはありません。本番で LAN flag を指定すると起動に失敗します。実 OAuth の秘密情報はこの Compose に渡しません。ログイン発行スクリプトは収集同意を自動で ON にしません。

## PC の起動

Docker Desktop（Linux containers）、Docker Compose、git が必要です。初回 build はインターネットからイメージと固定依存を取得します。記事表示・メタデータには Wikipedia への通常の送信接続が必要です。ルーターのポート転送、トンネル、インターネットへの公開は不要です。

PowerShell でリポジトリルートに移動します。`Get-NetIPAddress -AddressFamily IPv4` で同じ Wi-Fi の PC アドレスを確認します。この PC で調査した値は `192.168.11.10/24`、Wi-Fi profile は Private です。DHCP 等で変わっていれば現在のアドレスを使います。

```powershell
cd C:/Users/81905/Downloads/div/Wikimf
powershell -File scripts/lan.ps1 Init -BindIP 192.168.11.10
powershell -File scripts/lan.ps1 Up
powershell -File scripts/lan.ps1 Status
```

Init はランダム秘密情報を `.env.lan` に作り、既存ファイルは上書きしません。ファイルを共有・コミットしないでください。IP が変わった場合は `.env.lan` の `LAN_BIND_IP` を修正し Up でコンテナーを再作成します。DB password は既存 volume 初期化後に不用意に変更しないでください。

PC で `http://192.168.11.10:8080/health` を開き `status: ok`、`http://192.168.11.10:8080/app` で Dashboard が表示されることを確認します。Android のブラウザーで同じ `/health` が表示されることも確認します。

ファイアウォールの実変更は本作業では行っていません。レジストリの保存済み規則に 8080 を明示したものは 0 件でしたが、全ポート・ポート範囲・グループポリシーを含む有効な規則の判定は未完了です。この PC は全 profile の firewall が有効ですが、既存規則全体は権限不足で確認できていません。必要な場合の最小候補は **受信 TCP 8080、Private profile、ローカルアドレス 192.168.11.10、接続元 192.168.11.0/24** です。Public/全ポート/全接続元の許可は行いません。実際の追加は確認後に行います。AP のクライアント分離やゲスト Wi-Fi でも端末間通信が止まる場合があります。

## 検証ユーザーと端末連携

PC で次を実行します。

```powershell
powershell -File scripts/lan.ps1 Login
```

表示された `/lan-login` を PC のブラウザーで開き、表示されたトークンをフォームへ入力します。トークンは 15 分有効・一度限りで、URL に含めません。再発行すると前の未使用トークンは無効になります。同じ専用ユーザーにログインするため、履歴と収集停止設定は保持します。セッションは 1 日です。トークンをスクリーンショットやログへ保存しないでください。

Dashboard の Settings → Privacy で説明を確認し、クラウド収集への同意を ON にします。

1. 下記の LAN APK を Android に直接ダウンロードし、通常のファイル操作でインストールします。ADB は不要です。OS のインストール許可やセキュリティ設定の操作はユーザー自身が判断します。
2. **wikimf LAN 検証**を開き、Account の API URL に `http://192.168.11.10:8080/api/v1` を設定します。通常版にこの HTTP URL を入れると拒否されるのが正しい動作です。
3. アプリで端末連携を開始します。表示された 8 桁の user code と端末名を確認します。
4. 「Web でログイン・承認」を開きます。Android のブラウザーは PC と Cookie を共有しないため、先に PC で Login を再実行し、新しいトークンで Android の `/lan-login` にログインします。ログイン後、アプリに戻って同じ承認リンクをもう一度開きます。
5. アプリが表示した user code を承認画面に入力します。期限は 5 分です。切れていればアプリで連携を再開始します。承認後アプリへ戻り、連携確認を実行します。専用ユーザーと端末連携済みの表示を確認し、アプリの Account でクラウド記録の説明を読んで同意を ON にします。

OAuth の Google/GitHub ボタンは今回使いません。LAN 用バナーの「検証ログイン」から入ります。

## 実機の確認項目

1. **同期**: 日本語または英語の記事を 30 秒程度アクティブに閲覧し、アプリの同期を実行します。未送信が減り、PC Dashboard の Library/Activity に同じ記事と時間が反映されることを確認します。
2. **再送**: 連携後 Android の Wi-Fi を一時的に OFF にして閲覧し、未送信記録が保持されることを確認します。同じ Wi-Fi に復帰して同期し、送信が回復することを確認します。端末の Wi-Fi 操作はユーザーが行います。
3. **二重計上防止**: 同期後に再度同期し、Dashboard を再読込して新しい閲覧がないのに総時間が増えないことを確認します。ACK 消失後の同一 event 再送は自動テストでも duplicate と時間不変を検証します。
4. **記録停止**: PC Dashboard の収集を OFF にし、Android で同期して停止状態を取得します。その後の記事閲覧でクラウド時間が増えず、未送信の扱いと停止表示が維持されることを確認します。アプリ自身のクラウド同意 OFF と、バックグラウンド/Reader pause 時の記録停止も確認します。
5. **並存**: 通常版 `wikimf` のゲスト閲覧と保存済み設定が維持されていることを確認します。

日時、APK SHA-256、端末 OS、記事、閲覧前後の総時間、未送信数、結果を記録します。自動テスト合格だけで実機合格とは扱いません。

## APK の入手と build

GitHub Actions の **Validate MVP** の作業ブランチ実行から artifact **wikimf-lan-apk** をダウンロードし、ZIP 内の `app-lan.apk` を取り出します。`lan-apk-manifest.json` に APK SHA-256、証明書 SHA-256、別 ID、release HTTPS 境界の検証結果があります。APK が作成された同じ commit の実行を選んでください。artifact の保持は 30 日です。

PC 内で build する場合は次を実行します。Node24/JDK17/Gradle8.9/SDK35 を使います。bootstrap は既存のグローバル SDK を変更せず checkout 内に tooling を作ります。

```powershell
python apps/android/bootstrap.py
& ./apps/android/build.ps1 -Tasks @('testDebugUnitTest','testLanUnitTest','testReleaseUnitTest','assembleLan','assembleRelease','lintLan','lintRelease')
python scripts/verify_android_lan.py
```

PowerShell 呼び出し元の配列解釈により、対話 PowerShell では `& ./apps/android/build.ps1 -Tasks @('testDebugUnitTest','testLanUnitTest','testReleaseUnitTest','assembleLan','assembleRelease','lintLan','lintRelease')` を使えます。出力は `apps/android/app/build/outputs/apk/lan/app-lan.apk` です。本番 release はこの作業では再署名・配布しません。

## 停止と検証の限界

```powershell
powershell -File scripts/lan.ps1 Down
```

Down は専用 DB volume を残します。再起動は Up、再ログインは Login です。自動 stack 検証 `python scripts/verify_lan_stack.py` は別の `wikimf-lan-ci-*` project を loopback の 18080 で起動し、単一公開ポート・Dashboard の直接ルートと asset・ログイン・通常の端末連携・PostgreSQL 上の LAN 回帰テストを確認して停止します。通常の LAN project のデータには触れません。

ローカル実行と CI の最終結果、APK ハッシュは `docs/releases/evidence/lan-verification.json` に記録します。Android 実機、実 Wi-Fi の疎通、実 OAuth、本番 HTTPS はそれぞれ別に合否を記録します。

## 今回の検証結果と入手リンク（2026-10-12）

検証した実装 commit は `5f69887f6c64a41e14e2e0a948fdb31a117ae794`、作業ブランチは `feat/lan-verification` です。[CI run 38198782002](https://github.com/caprice1026-disc/Wikimf/actions/runs/38198782002) の全5 job が成功しました。PostgreSQL 全135件、Android CI emulator の通信・Reader lifecycle・privacy・記録制御15件が成功しました。ローカルの Android debug/LAN/release は各20件、lint error 0、build が成功しました。LAN 版には意図した cleartext 設定の lint warning が1件増えます。

[LAN APK ZIP を入手](https://github.com/caprice1026-disc/Wikimf/actions/runs/38198782002/artifacts/11724577822)できます。ZIP には `app-lan.apk` と `lan-apk-manifest.json` がリポジトリ相対ディレクトリで入っています。artifact の有効期限は 2026-11-11 です。取得した APK の SHA-256 は `55e8c570db91d709727af2b1e5c8c186acc0b85d3e87c264b21bb2923246eda9`、署名証明書 SHA-256 は `70ba5c3ce892becf8e821f6569704a618342aedf3b08e7538153c643425f352b` です。PC へ取得したコピーは `.tmp/artifacts/wikimf-lan-ci-5f69887.apk` にあり、ZIP/実APKのhash・署名・非debug・別IDを再検証済みです。

[LAN stack の実起動証拠](https://github.com/caprice1026-disc/Wikimf/actions/runs/38198782002/artifacts/11723764052)と[Android の回帰結果](https://github.com/caprice1026-disc/Wikimf/actions/runs/38198782002/artifacts/11724548282)も保存しました。Windows PowerShell 5.1 では初期設定の4キー・上書き拒否・公開IPv4拒否を隔離ディレクトリで確認しました。

この PC の Docker Desktop は通常の起動を試しましたが `Bad response from Docker engine` と内部 ping の EOF が続き、PC 上の Compose 実起動は確認できていません。OS/WSL/Hyper-V 設定や firewall の変更は行っていません。Docker engine の正常化後に Up を実行し、必要なら最小の firewall 規則の確認を行ってください。実 Android でのインストールと同じ Wi-Fi の同期はユーザー受入確認として残ります。main は `1d3f7db` のまま、merge は行っていません。
