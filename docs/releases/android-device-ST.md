# Android実機1台で行うrelease版ST

検証は [ST計画](ST-plan.md) の6段階で進める。エミュレーターで機能を確認した後、ST専用鍵で署名したrelease APKを実機へ入れ、実Wikipediaと実Backendの縦断、実機固有の挙動、3〜7日の自己利用を行う。今回のHTTPS Backend/Dashboard接続先は未準備であり、用意後にAccountから設定する。

## 作成したST用APK

2026-10-04、下記のcommitからrelease APKを作成した。APKはローカルの `dist/android-st-0.1.0-87ad275e62dd/` に保存し、Gitにはソースと [配布manifest](evidence/android-st-artifact-manifest.json) を記録している。

| 項目 | 値 |
|---|---|
| ソース | `87ad275e62ddba6a83d8467b0ab58e568bbad5ad` |
| ファイル | `wikimf-0.1.0-staging-release.apk`、7,347,666 bytes |
| APK SHA-256 | `5d976c84e5f877783d8ce26f952251aa30bc6b95ad7c9d61083be48ae59a3e95` |
| 署名証明書 SHA-256 | `ec08dcc593a05822dbd25d08a712de495b83e0d7fb7a433c1bbd50c56ecb1f84` |
| 配布設定 | `org.wikimf.reader`、0.1.0/code1、minSdk26、targetSdk35 |
| ビルド検査 | release単体10件成功・skip0、assembleRelease/lintRelease成功、v2署名・RSA3072・署名者1、debug鍵と異なる |
| アプリ設定 | debuggable無効、WebView debuggingはfalseを指定、cleartext禁止、debug専用network設定なし |

[ビルド・署名ログ](../../apps/android/verification/staging-release-build.txt) に結果を保存した。同梱trackerのSHA-256は `c254a5cdd9f4ec4936988c8c42ca4fc94bcd6bdda9666827579b300a50cd32b5` で、検証した共通ソースからの生成物と一致する。実HTTPS/OAuth、物理端末でのtoken保存・再起動、3〜7日の利用は未実施である。

## release APKのエミュレーター確認

既存debug版を保持したまま、別AVD `wikimf_release_api35` / API35 / WebView124.0.6367.219へ、この配布APKそのものをインストールした。ゲストで日英検索・記事表示・スクロール、HTTP接続先の拒否、端末内履歴を確認した。force-stop後、OS再起動後、同じAPKの `install -r` 後も、履歴・端末内保存同意・HTTPS設定が保持された。同版の再インストールであり、異なるversion間のmigration確認ではない。

[release検証集計](../../apps/android/verification/release-emulator-summary.json) に操作、APKの前後hash一致、更新時刻、各画面を記録した。日本語版はUnicode、英語版はEarthを使用した。検索語の入力はASCIIであり、日本語IME変換の確認は実機STに残す。クラウド未連携のゲスト操作なので、release版の認証token・Keystore保持・API同期の成功証拠にはしない。

このAVDは `ro.build.type=userdebug` / `ro.debuggable=1` で、アプリがfalseを指定してもWebViewのDevTools socketが存在し、読取専用の `/json/list` にゲストページが表示された。[診断結果](../../apps/android/verification/release-emulator-debug-diagnosis.json) を保存した。同じ124版のChromiumは、debug OSまたはdebugアプリでは [初期化で強制有効](https://github.com/chromium/chromium/blob/124.0.6367.219/android_webview/glue/java/src/com/android/webview/chromium/WebViewChromiumAwInit.java) にし、[無効化要求を受け付けない](https://github.com/chromium/chromium/blob/124.0.6367.219/android_webview/glue/java/src/com/android/webview/chromium/SharedStatics.java)。本アプリのrelease設定は変更せず、通常の `user` OS上でDevToolsから接続できないことを実機STへ残す。一時的なADB forwardは削除済みで、この診断によるページ操作は行っていない。

## ST用release APKのビルド

ローカルST鍵を初回だけ作成し、以後は同じ鍵を再利用する。鍵と保護されたパスワードは `apps/android/.local/signing/` に保存する。既存鍵は上書きしない。

```powershell
powershell -ExecutionPolicy Bypass -File apps/android/release-signing.ps1 -Create
powershell -ExecutionPolicy Bypass -File apps/android/build.ps1 -StagingRelease
```

出力は `apps/android/app/build/outputs/apk/release/app-release.apk`。ビルドは署名と証明書の一致、debug鍵との分離、debuggable無効、cleartext禁止、debug用network設定の除外を検査する。ST版は現在の `org.wikimf.reader` を使い、正式公開のapplication ID・Store登録は別途決める。現行releaseはR8/resource shrinkingを有効にしていないため、その最適化を適用した版の検証結果にはならない。

鍵をGit、APKと同じ配布フォルダ、ログへ含めない。ローカルパスワードはWindows DPAPIで保護し、現在のWindows利用者とマシンに依存する。暗号化ファイルを別のPCへコピーするだけで復元できると考えず、将来の移行では秘密管理の保管先を用意する。正式公開用鍵はST鍵と分離する。

CI等で別管理の鍵を使う場合はPKCS12 keystoreを秘密保管先から供給し、`WIKIMF_SIGNING_KEYSTORE`、`WIKIMF_SIGNING_STORE_PASSWORD`、`WIKIMF_SIGNING_KEY_ALIAS`、`WIKIMF_SIGNING_KEY_PASSWORD` の4環境変数を揃える。値をコマンド例やログへ貼らない。署名方式は [Android公式の署名手順](https://developer.android.com/studio/publish/app-signing) を参照する。

## 実機へのインストールと接続

配布時のAPK hashと証明書digestを検証記録と照合し、USB接続で `adb -s <実機serial> install -r <APKの絶対パス>` を実行するか、実機へAPKを転送して開く。既存debug版とは署名が異なるため、その上へ更新できない。署名エラー時に自動アンインストールせず、旧版の未送信queueと履歴を確認する。同じST鍵で署名した後続APKを更新し、設定・履歴が保持されることも確認する。

Accountで、信頼できる証明書を持つ実HTTPS APIの `/api/v1` URLを保存する。初期値 `https://wikimf.example/api/v1` は接続できるサービスではない。URLを変更すると端末資格情報とクラウド同意が消えるため、新しい接続先へ明示的に連携し直す。release版にHTTP例外やTLS検証の無効化を追加して接続を通さない。

Androidから連携を開始し、外部ブラウザでDashboardにGoogle/GitHubログインする。端末に表示された確認コードを入力して承認し、Androidへ戻って「連携を確認」を行う。Dashboard側の収集とAndroid側のクラウド記録同意をONにしてから、日英記事を実際に読む。アカウントの本人確認や端末の認証情報を証跡へ貼らない。

## 実機で集中して確認する項目

| 対象 | 操作 | 確認する結果 |
|---|---|---|
| WebView | 10〜20記事、日英、長短、画像/表、scroll、fragment、戻る/進む | 閲覧位置と履歴が自然で、不要な二重記録がない |
| ライフサイクル | Home、別アプリ、画面OFF/lock、放置、task終了、OS kill、復帰 | backgroundの時間が増えず、新session/再開が妥当 |
| 配送 | Wi-Fi→モバイル、Wi-Fi OFF、機内モード、offlineで数分読書、online復帰 | queue→WorkManager→API ACK→Dashboardが通り、送信が止まったままにならない |
| 外部ブラウザ | Android→Chrome等→ログイン/コード→Android | 元利用者・端末の連携が成立し、別account/取消では勝手に進まない |
| Keystore | release APKで保存後、アプリ終了/再起動/端末再起動 | 認証情報を再び読み出し、明示解除まで使える |
| 操作感 | 日本語IME、keyboard、回転、フォントサイズ、必要に応じlight/dark | 入力や読書を妨げず、重要操作が隠れない |

縦断では同じownerの実記事ID・source・active時間・coverage・ACK・Dashboard値を照合する。強制停止中のWorkManager停止はOSの挙動として区別し、手動起動後に未送信分を回復させる。実回線と物理端末のKeystore/電池はエミュレーター結果で代用しない。

表示済み記事をofflineで読み、その計測を後から同期する経路は検証対象に含む。記事本文をoffline向けに保存する機能はなく、offline中にプロセスが終了してWebViewを作り直すと本文を再取得できないことがある。この場合も未送信queueと履歴を保持し、オンラインへ戻って再読する。

## 3〜7日の自己利用記録

開始日、終了日、実際に使った日数、端末/OS/WebView、APK/source、読んだ記事数を記録する。毎日、未送信が残っていないか、昨日の記事や時間に不自然な重複がないかを確認する。時間が短すぎる、partialに偏る、検索後に記録が切れる、長い放置後に復帰しない、といった違和感は操作時刻と画面の状態を添える。

idle60秒などの測定条件も照合し、仕様と不具合を分ける。修正した場合は対象ケースを再確認してAPK/sourceを更新する。未利用日を実施日に数えず、数分の確認を数日利用の代わりにしない。結果は [Issue #13](https://github.com/caprice1026-disc/Wikimf/issues/13) へ集約する。
