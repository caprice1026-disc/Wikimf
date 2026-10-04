# Android実機1台で行うrelease版ST

検証は [ST計画](ST-plan.md) の6段階で進める。エミュレーターで機能を確認した後、ST専用鍵で署名したrelease APKを実機へ入れ、実Wikipediaと実Backendの縦断、実機固有の挙動、3〜7日の自己利用を行う。今回のHTTPS Backend/Dashboard接続先は未準備であり、用意後にAccountから設定する。

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

## 3〜7日の自己利用記録

開始日、終了日、実際に使った日数、端末/OS/WebView、APK/source、読んだ記事数を記録する。毎日、未送信が残っていないか、昨日の記事や時間に不自然な重複がないかを確認する。時間が短すぎる、partialに偏る、検索後に記録が切れる、長い放置後に復帰しない、といった違和感は操作時刻と画面の状態を添える。

idle60秒などの測定条件も照合し、仕様と不具合を分ける。修正した場合は対象ケースを再確認してAPK/sourceを更新する。未利用日を実施日に数えず、数分の確認を数日利用の代わりにしない。結果は [Issue #13](https://github.com/caprice1026-disc/Wikimf/issues/13) へ集約する。
