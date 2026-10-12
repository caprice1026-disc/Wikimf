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

2026-10-12、ユーザーの明示承認で専用 firewall 規則を作成しました。**受信 TCP 8080、Private profile、ローカルアドレス 192.168.11.10、接続元 192.168.11.0/24、EdgeTraversal Block** の範囲です。Docker 更新後も有効・許可・同じ範囲であることを netsh で再確認しました。他の規則や profile は変更していません。PC の IP が変わった場合は設定と規則の再確認が必要です。AP のクライアント分離やゲスト Wi-Fi では端末間通信が止まる場合があります。

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

2026-10-12 の後続確認では、ユーザーが Docker Desktop を **4.94.0.241994** に手動更新し、Engine **29.8.2** / Compose **5.5.1** の正常応答を確認しました。`wikimf-lan` の3サービスは起動済みです。`http://192.168.11.10:8080/health`、Dashboard の直接ルート・assets・API 設定が成功しました。実際のポート公開は `192.168.11.10:8080` の1つだけで、DB 5432 と API 8000 のホストへの割当はありません。単回ログイン、CSRF、通常のコード承認・端末交換、記録 OFF の維持を PC の入口経由で確認し、PostgreSQL の分離テストスキーマで LAN 回帰14件（同期・再送・二重計上防止・記録停止）が通過しました。検証用の一時端末は失効済みで、専用ユーザーの記録同意は OFF のままです。

PC の stack は実機確認用に起動を維持しています。上記 `Login` を実行し、Android のブラウザーから `/health` と検証ログインを確認してください。Android 実機での直接インストール・同じ Wi-Fi を通した同期は、ユーザー側の確認として残ります。実 OAuth / 本番 HTTPS は別の確認です。main は merge していません。

## LAN ログインの Origin 修正

通常のフォーム送信で `lan_origin_mismatch` になる原因は、ログインページの `Referrer-Policy: no-referrer` によりブラウザーが `Origin: null` を送ることでした。LAN gateway の `/lan-login` だけを `same-origin` に修正しました。`null`、Origin なし、別サイト、別ポートは引き続き拒否します。他ルートの `no-referrer`、CSRF、単回トークン、記録同意は維持しています。独立 Chrome の実フォームで正常ログインとCookie認証、再利用拒否、CSRF拒否を確認し、LAN unit19件が通過しました。ブラウザーのフォーム送信もCIのLAN stackで検証します。

修正はPCのgateway側だけです。すでにインストールしたLAN APKをそのまま使えます。スマホで `/lan-login` を再読み込みし、新しいトークンを入力してください。端末コードは別で5分有効なので、失効していたらアプリから連携を再開始します。


2026-10-12: Origin 修正 commit `8e29f4d00096a8799bc9858c81215f5cd46d46fa` の [CI run 38241459449](https://github.com/caprice1026-disc/Wikimf/actions/runs/38241459449) は全5 job 成功。PostgreSQL 全140件、新しい native browser form 回帰、Android 回帰が通過した。APK はサーバー側修正で変更不要。ユーザー提供の画面で Android の LAN ログインページ到達と端末コード発行を確認したが、実機の最終ペアリング・同期受入は確認待ち。トークン・端末コードは文書やGitへ保存していない。


## 0.1.2 LAN修正と署名の継続

2026-10-12: reading-v2は表示本文DOMを使い、50%以上の表示を累積1.8秒、200ms周期で計測する。読了は80%以上のcoverageと30秒以上のアクティブ時間。推定文字数は本文のcovered文字数と時間上限の小さい方で、日本語1,800字/分・英語1,000字/分。この係数は理解度や科学的な読速限界を表さない。旧イベントもrawのまま再集計し、時間や未表示coverageを増やさず手動状態を優先する。日本語の過去の推定値は新上限により変わり得る。

CI APKは一時署名鍵によるテスト専用で、既存端末への継続更新には使わない。artifact名は`wikimf-lan-ci-test-apk`。旧run38198782002の署名鍵は手元にないため、そのAPKへの同一IDの上書き更新はできない。旧アプリのアンインストール・データ削除は行わない。

ローカル検証用には既存`.tooling/debug.keystore`を再利用する。秘密鍵はGit/CI artifactへ含めない。`build.ps1`実行前に鍵の存在を確認し、配布前に`verify_android_lan.py --expected-certificate <既知の証明書SHA256>`で一致を検証する。次回更新では`--previous-apk <前のローカルAPK>`も指定し、署名・ID一致とversionCode増加を確認する。鍵が見つからないときに新しい鍵で更新可能と扱わない。ローカルdebug鍵は検証用で、本番release鍵とは別。CIの継続署名を行う場合は保護した専用鍵の登録・アクセス方針を別途承認してから整備する。

今回の新APKは旧CI APKに上書きできない。専用エミュレータの新規インストール・同じローカル鍵での更新を検証する。実機に新しいapplicationIdで並存させる場合は、旧アプリのローカルOutboxが自動移行されないことを説明し、別途承認を得る。

2026-10-12の追加承認: 旧CI版を保持して並存する配布用検証版は`org.wikimf.reader.lan.local`、表示名`wikimf LAN local 検証`とする。ビルド型`lanLocal`はLANのみのHTTP条件を継承し、releaseはHTTPSを維持する。`scripts/publish_local_lan.ps1 -ExpectedCertificate 4ccaa93feab14719472bb0bf42707e79027b8ec16f88aef576cf4ac8b8612519`でこのPCの既存鍵を照合してコピーする。新アプリを同じLANユーザーへ連携するとサーバー受領済み履歴は共有できるが、旧アプリのローカル未送信と端末履歴は移行しない。旧アプリからの同期完了を先に確認し、旧アプリを消さない。旧・新で同時に記録した時間はサーバーの重複区間排除で二重計上しない。

配布コピーは`.tmp/lan-delivery/wikimf-0.1.2-lan-local.apk`と`manifest.json`。manifestはsource commit・実APKハッシュ・versionCode・証明書を記録する。CI一時署名APKとは別。更新検証では専用エミュレータでv4→v5へ上書きし、認証、履歴、設定、未送信の同じpayloadを照合する。SharedPreferencesの非同期保存をテストVM終了前に完了させてから比較し、未保存のfixtureを更新による消失と誤認しない。
