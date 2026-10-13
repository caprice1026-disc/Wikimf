# ローカルUIフィードバックの実行計画

## Purpose / Big Picture

公開版c79746b7（APK 0.1.2-lan-local/versionCode6）を基点に、Dashboardの自動判定の説明、60分称号の分表示、Android外部リンク確認、Wikipediaホームへ戻るメニューを改善する。今回はローカルのみで変更・検証し、remote mainへのpushとRelease公開をしない。実機STのDB・認証・未送信を保持し、テストには専用AVDと独立QA/合成データだけを使う。

## Progress

- [x] 既存変更なし、現版・AVD停止・隔離QA停止を確認し、親へAstra用情報を返した。
- [x] 60分のAPI値はactive_ms/3,600,000で、Dashboardが単位なしの生整数を表示しているとコードで確認した。
- [x] #40を起票。単位/境界unitとBackend時間指標7件成功。browser/実AVDは操作枠返却後に確認する。
- [x] 外部リンクのリンク先・理由・戻り方・取消/開くを改善し、URL拒否を維持する。
- [x] ホームメニューを追加し、通常WebViewの履歴・現在文書の保存・pause/同意を維持する。
- [x] 同一鍵/同IDでversionCode7候補をローカル作成し、v6からの保持とUIを専用AVDで検証する。
- [x] 親へ安定build/AVD/QAとAstra専用操作枠を返す。Astraと同時操作しない。
- [ ] 追加承認の #41 未送信破棄確認、#42 連携/同意案内、#32 未送信中の同期表示をローカル修正し実画面で再検証する。4項目の評価用操作枠は先に返す。

## Surprises & Discoveries

添付2枚の正規Library consumer取得は、Windows Pythonのos.setxattr未対応で完了できない。画像は未実視と明示し、制約を迂回せず、独立して実装と合成UIで確認する。

## Decision Log

2026-10-13: reading-hourだけはrawミリ秒を分へ変換し、progressバーも分を使う。表示は0.1分単位で切り下げ、59.999分が未達成なのに60分と見えないようにする。記事/言語の称号には各単位を表示し、APIの計算・earned判定は変更しない。

2026-10-13: 自動判定のある記事と手動表示状態を区別する。手動設定だけで時間や称号を増やさないことを説明する。外部リンクは既存UrlPolicyをそのまま使い、scheme/userinfo/port等の拒否を緩めない。

2026-10-13: ホームは現在Readerの日英wikiを使い、通常loadUrlの戻る履歴を保持する。移動前に同じ文書の未保存サンプルをflushする。実ユーザーの8080 APIや同意設定をテストで変更しない。Astra評価childへ修正前のAVD5580/隔離QA18080枠が渡った。返却までadb/APK操作・QA配信更新はしない。こちらはソース編集・unitのみを進める。

## Work and Validation

apps/dashboard/src/format.tsに称号表示の純粋な単位変換を追加し、components.tsxでprogress/textへ使う。backend/projection.pyのfootprints説明とDashboardのAchievements説明を自然な日本語にする。Android MainActivityの外部リンクdialogとメニュー/ReaderControllerのhome移動を変更する。署名鍵は既存.tooling/debug.keystoreを保持する。

Node24でDashboardのformat回帰（0、1.5分、59.999分、60分、記事/言語の単位）、browser回帰とbuildを実行する。Androidはunit/lint/buildと専用emulator-5580で実dialog・ホーム/戻る・保存・privacy/lifecycle回帰を行う。QA composeはwikimf-feedback-qa、入口127.0.0.1:18080（emulatorから10.0.2.2:18080）だけ。通常LANのDB/APIは停止しない。

APKはversionCode7、0.1.3-lan-localのローカル候補とし、.tmp/ui-feedback-20261013へ保存する。公開v6 APKやRelease assetsを上書きしない。同じcertificate 4ccaa93feab14719472bb0bf42707e79027b8ec16f88aef576cf4ac8b8612519、applicationId org.wikimf.reader.lan.localを実APKで確認する。

## Outcomes & Retrospective

2026-10-13: Dashboard単位/日付テスト・型チェック・ビルド・合成ブラウザ26操作（PC/390px）、Backend7件、Android debug/lanLocal unitと3 variant lint/build、実WebView/Compose UIを含む関連19件成功。Compose仮想ノードはプラットフォームのfindAccessibilityNodeInfosByTextで取得できず、既存UIテストと同じ子ノード巡回に修正した。通常DashboardのOAuth回帰にはLAN専用ビルドでなくlocalhost:4173の通常ビルドを使用した。

2026-10-13: 公開v6から非debug v7を同じID/証明書で上書きし、暗号化認証・履歴・設定・未送信イベントの厳密hash保持を確認。QA実送信ではprivate準備helperが記事一覧の先頭を英語と仮定し、現在の日本語記事にenwikiを指定して拒否された。製品不具合と区別し、英語記事を明示選択するhelperへ変更、特定した自身の合成イベントのみを整理した。正しいfixtureの実ACK/duplicate再送は成功し、cloudConsent OFFへ復元した。公開APK/assets/実運用8080は変更していない。

2026-10-13: ローカルAPK .tmp/ui-feedback-20261013/wikimf-0.1.3-lan-local.apk、versionCode7、SHA256 ddb634ec4389fbd4ac8770322a600174b54b269bfad94dda2e75fbf77faccac4。manifestには未コミットのローカル変更と公開版未変更を明記。#40はAstra after評価までopen、追加の破棄確認を#41、同意案内を#42へ登録し、同期表示は既存#32へ追記した。

開始時点。未送信破棄の確認候補はAstraで再現確認・提案する範囲に残し、この4修正に大規模変更を混ぜない。ローカル検証でIssueをcloseする場合はremote未反映・公開版未修正と明記する。

2026-10-13: Android debug/lanLocal unitは成功。実外部dialogとhome/戻る/flush/pauseのinstrumentationを準備し、評価枠返却まで未実行。新APKも未作成・未配布。

2026-10-13: 外部dialogのリンク先・対象外理由・戻り方・取消/開くと長いURLのscrollを実装。homeメニューは移動前のsetActive(false)/flushと通常loadUrlを使い、世代の違う遅延callbackは無視する。関連実UIテスト（危険URL拒否、メニュー/戻る/同意、保存/pause）を用意し未実行。Dashboard unit/型チェック、Backend7件、Android debug/lanLocal unitは成功。親からAstra使用枠返却待ち。公開v6/実ST配信はそのまま。
