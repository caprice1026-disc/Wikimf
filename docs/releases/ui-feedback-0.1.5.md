# Wikimf 0.1.5 LAN 検証版

Android 0.1.5-lan-local（versionCode 9）とChrome拡張0.1.5を配布するLAN検証用prereleaseです。Androidの安全な破棄確認・同意案内・Wikipediaホーム/外部往復、Dashboardの単位/手動状態説明と一覧条件/位置の保持、Chromeの同期状態・操作中表示・まとめて同期・段階表示・期限接近注意を含みます。

実LANサービス/DBはこの公開操作では更新しません。Dashboardの修正はmainのソースに含まれますが、既に稼働しているDashboardへ自動反映されません。公開インターネット用のHTTPS/OAuth配備を行ったReleaseでもありません。

## 入手と内容

[GitHub Release v0.1.5-lan.1](https://github.com/caprice1026-disc/Wikimf/releases/tag/v0.1.5-lan.1)から、APK、拡張ZIP、README-ja.md、manifest.json、SHA256SUMS.txtを取得してください。manifestは実際のsource commit・署名・配布ファイルのSHA256・検証範囲を記録します。CIの一時署名APKを配布用に使わないでください。

## Androidの更新

APK名は `wikimf-0.1.5-lan-local.apk`、applicationIdは `org.wikimf.reader.lan.local`。従来の安定ローカルLAN鍵を継続使用した非debug版です。証明書SHA256は `4ccaa93feab14719472bb0bf42707e79027b8ec16f88aef576cf4ac8b8612519`。通常版/ST版やCIの一時鍵とは別です。

現在の記事履歴と未送信を確認してから、APKを開いて更新してください。ADBなら `adb install -r wikimf-0.1.5-lan-local.apk` を使います。公開v0.1.2/code6と同じappId・署名で、code9へのバージョン増加を照合します。保存済みv8→v9の実更新では、設定・暗号化資格情報・履歴・Outbox・診断の全内容hash一致を確認済みです。署名/IDの照合と、データを持つ端末での実更新を区別しています。

署名が違うと表示された場合は、更新を止めて既存アプリと未送信を保持してください。更新を通すためにアンインストール/データ消去をしないでください。別appIdの通常版をこのAPKで置き換えることもできません。

更新だけでクラウド同意をONにせず、API接続先と端末連携、現在の記録/同期状態を確認します。API変更は資格情報と同意に影響するため、既存の正しい設定を不用意に変更しないでください。新規の同一LAN利用時はAccountのAPIを `http://192.168.11.10:8080/api/v1` に設定し、既存の手順で明示的に連携・同意します。

## Chrome拡張の更新

`wikimf-0.1.5-lan-extension.zip` は11ファイルの未パッケージ化拡張です。API/Dashboardは従来と同じ `http://192.168.11.10:8080` に固定され、Chrome Web Store版ではありません。信頼できる同一LAN専用です。自分の接続先が異なる場合、この固定ZIPを使って別サーバーへ接続しようとせず、既存のHTTPS/LAN build手順で自分のoriginを明示してください。

既存拡張のIDと読み込みフォルダー、未送信を確認します。Chromeを閉じるか拡張の計測を停止してから、ZIPを**同じフォルダー**へ上書き展開し、`chrome://extensions` で既存拡張を再読み込みします。拡張を削除したり別フォルダーへ新規読み込みしたりすると、IDが変わり旧storageが自動移行されません。未送信を持つ旧拡張を削除しないでください。既存IDの再読み込み後に未送信と設定が残ることを確認します。

初回だけはZIPを専用フォルダーへ展開し、開発者モードからmanifest.jsonのあるフォルダーを読み込みます。端末連携は本人が明示的に承認し、Dashboardの収集許可と拡張の新規記録設定を別々に選びます。更新で新しい資格情報を自動発行したり、新規記録を自動再開したりしません。

期限注意は本人の未送信のうち24時間以内の候補だけを表示します。端末作成時刻とイベント時刻に基づく概算で、受理や救済を保証しません。超過/不明は仕様欄に分けます。7日は送信に使える期限で、認証待ち中に必ず7日で物理消去するという意味ではありません。既存の容量・所有者・最新制御・個別ACK・停止条件は維持しています。

## checksum

PowerShellで `Get-FileHash -Algorithm SHA256 <ファイル>` を実行し、SHA256SUMS.txt/manifest.jsonの同名ファイルと一致することを確認してください。APK/ZIPだけでなくREADMEとmanifestもchecksum対象です。秘密鍵、env、DB、ブラウザprofile、実資格情報はGitにも配布物にも含めません。

## 検証範囲と残件

公開前にNode24のtracker/extension単体、Dashboard unit/typecheck/buildとPC/390pxの26操作・一覧復帰10操作、Chrome合成DOM/MV3/queue回帰、Android unit/lint/build/署名/HTTP境界を再確認します。GitHub CIは同一commitのbackend/tracker-extension/dashboard/android/isolated LAN stackを確認します。最終の件数・CI URLはRelease本文とmanifestを優先してください。

保存済みのAndroid実UI10件、同署名v8→v9更新保持、自己生成QA記録のACK/duplicate、Astraによるv8/v9実QAとv10合成表示6ケースの独立評価があります。今回の再buildを、それらすべての再実行や実在利用者調査とはしません。合成Chromeの成功を実QA認証の成功に置き換えません。

未実装/未検証として、恒久失効した旧端末キューの非破棄救済（#4）、元の実Android同期失敗原因（#32）、実Chrome連携後の状態鮮度/同記事導線/本来のtoolbar/ATや途中失敗からの複数batch受入（#43/#44）、実OAuth/本番HTTPS/物理端末の長期ST（#13）を残します。Chrome QA資格情報の新規発行は行っていません。

この公開では実LAN/DBの再作成・migration・配備・認証状態変更を行いません。運用更新が必要な場合は、既存data/volume/鍵を保持した手順と権限を別途確認してください。[LAN手順](android-lan-verification.md)と[ST計画](ST-plan.md)を参照してください。
