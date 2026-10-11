# Issue #19〜#27 の修正と検証

2026-10-11。ユーザーの指示によりmainへ直接pushする。実OAuth・HTTPS・物理Android・継続利用は未準備と確認したため、#4/#11/#12/#13はOPENを維持する。実装計画は [.agent/issues-19-27.md](../../.agent/issues-19-27.md)。

## Backend・配備

#19: 投影のイベント・session・interval・記事・手動判定を専用の固定snapshotで読む。PostgreSQLはREPEATABLE READ、SQLiteは明示BEGINを使う。同期や削除を受け付けるtransactionの隔離設定・Userロックは変更しない。観測がないsessionも投影対象にしない。

`test_issue_regressions.py` はイベントSELECT後、session SELECT直前に別HTTP requestを実行し、新規session・既存sessionへの追記・記事削除・全削除・手動判定をcommitする。重なった統計は変更前の一貫した200を返し、次の取得は変更後の値を返す。SQLite WALと実PostgreSQL17.6で成功した。最終PG suiteは105件成功、skip0。既存の重複配分、期間統計、認証・削除・並行処理も含む。契約schemaの再生成チェックも成功。

#24: ComposeはDBパスワードをURIへ埋めず、個別接続項目へ生の値を渡す。BackendとAlembicは `URL.create` で組み立てる。単体4ケースで `@`、文字どおりの `%40`、URI予約文字を保存し、表示URLがパスワードを隠すことを確認した。

`scripts/verify_compose_passwords.py` で英数字・`@`・`%40` の3種類をそれぞれ別projectで起動し、migrationと `/health`、同じ初期化済みvolumeからの再起動が成功した。既存volumeを削除しなかった。テストvolumeは保持した。管理proxy用の公開CAだけをテスト用buildへ一時mountし、製品Dockerfileや秘密設定を変更しなかった。既存DBのパスワード変更はDBロール側の更新も必要であり、[運用手順](operations.md) に記載した。

## Chrome・共通tracker

#20: article.resolveは最新recording-controlを取得してからURLを送る。停止中や取得失敗時はResolverを呼ばない。ネットワーク待機後にローカル記録設定と連携deviceを再確認する。新ページ/reload/pageshowが通る同じworker経路で、既知OFF・古いON・取得失敗・再同意を検証した。

#21: 明示syncは一回だけ自動送信設定を上書きする。自動syncとの競合時は完了を待って明示syncを実行する。収集停止と失効の確認は維持する。停止/送信保持中のACKと同期後の連携解除、自動syncの不送信を検証した。statusとpopupも保存済みsendQueuedを表示する。

#22: 1msでも壁時計が逆行したら、旧sessionを最後の有効サンプルで閉じて新sessionへ移る。flush前後、直接close、大きな時計跳躍を含め、interval内・非重複・累積時間一致を検証した。Android/Chrome両sourceの同じcoreイベントが拡張の契約検証を通る。共通tracker17件が成功。

#23 Chrome: 削除markerの更新で旧sessionを停止し、cutoff中はleaseと開始を拒否する。期限後はcontentの定期refreshから新sessionを開始できる。5分の仮想時計を使い、cutoffと等しい時刻でも拒否、1ms後の新sessionは別ID・新開始時刻で同期されることを実workerで検証した。Backendも旧sessionを `history_deleted` で拒否し、cutoff後のsessionをacceptedとして計上する追加テストが成功した。

拡張unitは19件成功、tracker/extensionのbuildも成功。`worker-regressions.test.js` は製品workerをそのまま読み込み、Chrome APIとHTTPのみをfixtureにする。実Chromium154でMV3を読み込む既存テストは、環境の管理ポリシーによる `Loading of unpacked extensions is disabled by the administrator` で未実施。これは合格件数へ数えない。

## Android

#23 Android: 削除markerをNative設定へ保持し、Readerへ変更通知する。旧sessionは停止し、期限中の新規計測を保留し、期限後に新IDで自動再開する。旧epoch/削除済みOutboxの破棄は維持し、連携解除・owner切替でmarkerを消す。旧sessionの遅延イベントもNative側で保存しない。

#25: 非表示中のdocument_changedでもNative contextを無効化する。Account/Search/背景化から戻る、または一時停止を解除すると、新しい本文とsessionで開始する。DOMが変わらなければ同じsessionを維持する。

#26: HTTP本文を読み切りparseするまでOkHttp callbackのworkerで処理する。Mainへ生Responseを返さない。Response.useでcloseし、coroutine cancelではCall.cancelで本文読み取りも中断する。遅延本文・chunked本文・MainのStrictMode・検索キャンセルを端末上回帰テストへ追加した。

#27: 日英のindex.php?title、action=view、curidを共通URL契約と揃える。重複query、競合identifier、edit/oldid/diff/redirect、不正ID・hostは拒否し、DOM namespace・Resolverの最終確認は維持する。

JDK17/Gradle8.9/SDK35でJVM12件、debug APK、instrumentation APKのbuildが成功。lintはerror0/warning9（既存の依存更新・backup属性・資格情報commitの警告）。Chromium154の実DOMでAndroid adapterを動かし、非表示中の本文更新通知、非表示時間の不加算、新本文/new session、DOM不変時の同じsessionを確認した。この実DOM検証はAndroid Nativeの実行証拠とは分ける。

Nativeの追加回帰はCIのAPI35エミュレーターで実行する。Readerは実WebView・Native controller・SQLiteを使い、WikipediaとHTTP応答を合成fixtureにする。削除期限の自動再開は実タイマーを短縮したcutoffで確認する。5分の境界はChromeの固定時計検証で確認する。物理端末・実OAuth・実Wikipediaとの縦断は#13へ残す。

## リモート確認

最初の修正 `c9361cf6423fbaa940d90d0b2641e46da7d06ec5` はmainへのpushと [CI全4job成功](https://github.com/caprice1026-disc/Wikimf/actions/runs/38107985129) を確認した。Androidと追加回帰を含む最終CIの結果は、実行後にこの節へ追記する。Issueは対応する修正・実行済み証拠がmainへ反映された後にcloseする。
