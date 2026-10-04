# MVP-AのST計画

更新日: 2026-10-04。実装済み機能の残るシステムテスト（ST）を実環境へ移すための手順。ケースごとの現在地は[受入台帳](acceptance-matrix.md)、仕様の基準は[ADR](../adr/0001-mvp-contract.md)と[実装計画M10](../wikimf-implementation-plan-v0.1.md)。残件は[追跡Issue #13](https://github.com/caprice1026-disc/Wikimf/issues/13)で管理する。Androidはエミュレーターの機能確認後にST用署名済みrelease APKを作成し、ユーザー自身の実機1台で縦断確認と3〜7日の自己利用を行う方針へ変更した。実OAuth、HTTPS配備、物理端末の操作は必要な環境が揃ってから実施し、エミュレーター合格を実機合格に置き換えない。

## Androidの6段階の進め方

| 段階 | 実施内容 | 次へ進む条件 |
|---|---|---|
| Phase 1 | API35エミュレーター＋実Backend/PG＋Dashboard。検索、日英記事、計測、永続化、同意/削除、復帰、offline同期を既存証跡と追加実測で確認する | 機能不具合を修正し、追加ケースと影響範囲の回帰が成功。合成provider/metadataと外部環境待ちは明記する |
| Phase 2 | ST専用鍵でrelease APKを署名し、署名・manifest・asset・起動を検査する | インストール可能なAPK、source SHA/hash/証明書digest、再ビルド手順が揃う。debuggable・WebView debugging・cleartext例外を有効にしない |
| Phase 3 | ユーザー自身のAndroid 1台へAPKをsideloadする | OS/WebView/端末とAPKを記録し、起動・設定・Wikipedia表示を確認する |
| Phase 4 | 実Wikipedia→tracker→実Backend→PostgreSQL→Dashboardを通す | 所有者と記事ID、正の読書時間/coverage、ACK、画面の値を照合する。実HTTPSとGoogle/GitHubの外部ブラウザ連携を含む |
| Phase 5 | 実機で差の出やすいWebView・ライフサイクル・回線・Keystore・操作感を確認する | 下記の重点項目を通し、背景での誤計測や同期停止、認証情報喪失がない |
| Phase 6 | 3〜7日、普通にWikipediaを読む | 実際の期間・記事数・不具合・修正後確認を記録し、日常利用で表示と計測が自然かを判断する |

実機では全ての単体テストをやり直さず、10〜20記事を普通に読みながら長短・画像/表・日英・fragment・戻る/進むを確認する。Home、別アプリ、画面OFF、lock、放置、task終了、OS killの前後で読書時間を照合し、background滞在を加算しないことを見る。

回線確認はWi-Fi→モバイル、Wi-Fi OFF、機内モード、数分のoffline読書からの復帰を含める。保存queue→ネットワーク復帰→WorkManager→API ACK→Dashboardを一続きで照合する。端末の「強制停止」中はOSがバックグラウンド処理を止めるため、通常のprocess killと区別し、手動起動後に復旧することを確認する。

端末連携はAndroid→外部Chrome等→Google/GitHub→確認コード→Android→exchange→記録開始の順で行う。release APKのKeystoreはアプリ終了、再起動、端末再起動を越えて認証情報を読めることを確認する。日本語IMEとkeyboard表示時の配置、スクロール、回転、フォントサイズも実機で見る。

3〜7日の自己利用では、時間が短すぎる、partialに偏る、検索から戻ると記録が切れる、長時間放置後に再開しない、前日の記事が重複する、同期が止まる、という違和感を記録する。idle60秒など既知の計測条件は併記し、期待する使用感と測定仕様の差を判断する。利用していない日は利用日数に含めない。MVPでは実機1台を基準とし、複数端末サービスによる検証は将来のStore公開時に必要性を判断する。

ST署名鍵はdebug鍵・正式公開用鍵と分離し、Gitや配布ZIPへ含めない。同署名のST版を再インストールして更新を確認する。正式公開用署名への移行、Play Store登録、複数端末展開は今回のAPK作成と別の受入条件である。

## 実施順と判定

P0は閉じた検証の縦断確認と漏洩・二重計上・削除復活の防止、P1は実OAuth/HTTPS/署名など配布前の必須条件、P2は性能・端末差・利用評価。P2でも発見した安全性・データ整合性の不具合はP0へ上げる。資源待ちの項目は未実施のまま残し、下位層の合格で置き換えない。

| ID | 優先度 | 前提・依存 | 完了する作業 | 主な受入/Gate |
|---|---|---|---|---|
| ST-01 | P1 | 管理者がHTTPS originと実provider資格情報を用意、ST-03 | Google/GitHubの登録・callback・テストuser・secret注入 | D15～17、G03/G10 |
| ST-02 | P0/P1 | ST-01。独立したQA user A/Bとbrowser profile | 実OAuth、明示identity追加、state/nonce/replay、scope/user分離 | D08/D10/D15～17、G03/G09 |
| ST-03 | P1 | 選んだ検証配備先、DNS/TLS、PG永続領域 | HTTPS、cookie/CORS/CSRF/cache/log/秘密管理 | D21/D24、G00/G09/G10 |
| ST-04 | P1 | application ID、署名鍵と配布方式を決定、ST-03 | 署名APK/拡張、install/update/unlink/uninstall、生成物検査 | N11/D05/D08/D19/D21、G00/G10 |
| ST-05 | P0 | API35 emulator、linked QA user、最終APK。後日物理端末 | Native focus、Reader/navigation/lifecycleの操作と区間照合 | N01～14、R06/07/09/10/13、G01/G05/G06 |
| ST-06 | P0 | ST-05、実日本語IME、制御した検索応答 | 候補/本文検索、言語世代、履歴、エラー、layout | S01～14、G02 |
| ST-07 | P0 | 実Chrome＋Android、同じQA user、実PG。実metadataは外部疎通時 | 両host→同user Dashboard、閾値/Document/再読/union/時区間 | N01/02、R01～04/08/11/12/14/15/18、D06/D18/D20、G04～08 |
| ST-08 | P0 | 実Google Chrome専用profile、最終unpacked artifact | 複数window/OS focus、本文/anchor/BFCache/対象外URL | N05/N07、R05/06/09/12/13、G06/G07 |
| ST-09 | P0 | 隔離QA user、通信障害proxy、queueを残せる端末 | ACK紛失/再送/kill/owner/容量/期限/clock/skew | D01～10/D21～23、G07～09 |
| ST-10 | P0 | 隔離し削除してよいQA user、ST-09のoffline queue | consent/pause/deletion/epoch/export/public/cache/称号 | S13、R16/17、D10～14/D24、G09 |
| ST-11 | P0/P1 | 隔離PG database、検証配備のbackup/runbook | populated migration、失敗復旧、実dump/restoreと最新safety適用 | D11/12/19、G08～10 |
| ST-12 | P2 | 機能ST合格、実機1台、端末/履歴件数/ネットワークを固定 | p95/scroll/電池/静読/大文字/UIと3〜7日の自己利用評価 | N11/12、S03/11、R08～11、D07、G06/G08/G10 |
| ST-13 | P0 | 上記結果と最終SHA/artifactが確定 | 必須suite、70行/G00～10、配布物対応を照合し判定 | 全ケース、G00～10 |

## 先行確認済みの範囲

下記は既に実行した操作であり、関係するsource/artifactや環境が変わらない限り同じ操作を繰り返す必要はない。各STの残る条件を追加で確認する。

| ST | 確認済みの範囲 | 残る範囲 |
|---|---|---|
| ST-05 | API35で明示native focus回帰1件、persistence/Keystore2件、実Overview/PrivacyのIntent1件。Search→ReaderのURL/scroll1800/history/session維持、fragment同session、回転後位置/履歴とnative前後移動、Home後12秒active不変。[Android証跡](../../apps/android/VERIFICATION.md) | 物理端末、OS back/無効境界、外部/new-window/SSL/renderer、Chrome初回画面以後、文字サイズ/lock/kill。回転時はsession再作成を観測したためreload/二重計上条件も残る。 |
| ST-07 | 実Chrome/エミュレータ→実API/PG→同ownerの刷新後Dashboardで16 checks。両sourceの正の活動とsource別表示件数のAPI一致を確認。[dashboard-redesign-api.json](evidence/dashboard-redesign-api.json) | identity/metadataは合成。実provider/実metadata、host閾値直前直後、両端末同時区間、DST等を追加。 |
| ST-08/09 | 実Chrome worker stop/restart、tab arbitration、offline保存/個別ACK。最終strict schema2件accepted、10,001ms増。[chrome-postgres.json](evidence/chrome-postgres.json)。Android実offline2件→復旧0、累計81,821ms、非隔離。[offline-observation.json](../../apps/android/verification/offline-observation.json) | Android force-stop/reboot、ACK responseのみ紛失、queue容量/実disk障害、実複数window/OS focus、削除/re-link等。 |
| ST-09/10追加 | Chrome容量/期限エラーからの再開12判定、Androidの期限/epoch/削除/拒否payload消去・診断100件上限・同意OFF時のURL送信停止を確認。[追加検証](issue-fixes-dashboard.md) | 実disk障害、物理端末での同意/再開、実provider/HTTPS下の削除・復旧を追加。 |
| ST-11 | 保持データ0002→0004 migration、実pg_dump/pg_restoreと最新safety適用の14 checks。[issues-14-18-recovery.json](evidence/issues-14-18-recovery.json) | migration失敗、検証配備先でのbackup運用/復旧時間とreplay照合。 |
| ST-12 | local PG、500session/event/interval、warmup3、各30 requests、HTTP TestClientのp95最大219.73msで500ms目標をこの条件では満たした。[performance.json](evidence/performance.json) | TLS/WAN/並行負荷、物理端末電池/体感、静読/分割読書、一週間程度の利用評価。 |
| ST-13 | 追加修正source `dd575fb3362a43ca00043248bddf9dcca190c385`で[remote CI全4job成功](https://github.com/caprice1026-disc/Wikimf/actions/runs/37196169054)。PG95/JVM10/Native8+pairing1と[3artifactのmanifest](evidence/issues-artifact-manifest.json)を固定。[画面刷新と追加検証](issue-fixes-dashboard.md)を参照 | 実環境のST結果を追加し、公開配布source/hashを再照合してG10を判定。CIに実OAuth/実browser/emulator instrumentationは含まれない。 |

## ST-01: provider登録

検証用にAPI originとDashboard originを決める。以下の`https://api.example.test`は説明用で、実接続先ではない。現在の実装はBackendで認証し、Android/拡張はwikimf独自の端末grantをWebで承認する構成。

1. GoogleのWeb application OAuth clientを作り、同意画面・検証用userを設定する。認可redirect URIは実API originに`/api/v1/auth/google/callback`を付けた値。実装scopeは`openid profile`。scheme、host、path、末尾slashを一致させる。[Google Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
2. GitHub OAuth Appを登録する。HomepageはDashboard、Authorization callbackは実API originの`/api/v1/auth/github/callback`。現在の実装scopeは`read:user`。providerのdevice flowをwikimf端末grantと混同しない。[GitHub OAuth App登録](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
3. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`をBackendだけへ注入する。登録画面・環境値・tokenをreportへ貼らない。secretの保管/失効担当と検証後のQA grant削除を記録する。
4. 実providerの同意画面からBackend callback→Dashboardまでを各1回行い、provider名、UTC日時、内部user_idの一致/不一致、HTTP結果だけを保存する。provider登録完了だけをログイン成功にしない。

## ST-02: 実認証とユーザー分離

QA A/Bを別profileで使う。AのGoogle→logout→GitHubで、同emailであっても未承認の自動結合がないことを確認する。AとしてログインしたままAccountからGitHubのidentity追加を開始し、承認後はGoogle/GitHub両方の再loginで同じ内部Userになることを確認する。片方解除後は最後のidentityを解除できないことを確認する。

追加操作を中断→別providerの通常login、並行したGoogle/GitHub login、別profile callback、state改変、callback再使用、承認拒否/期限切れを試す。実providerの署名/state/PKCE確認と、既存の合成provider adapterによる認証suiteは別欄にする。端末grantはcode一致の明示承認が必要で、未承認pending、期限切れ、pollの429、exchange1回、replay拒否を確認する。Wikipedia JS/popupへtokenを返さないことも確認する。

Issue #18で追加した本人確認も同じ実providerで検証する。10分を過ぎたsessionでは重要操作が403となり、Google/GitHubで既存identityを選んだ後だけ実行できること、別subject・別session・取消では操作を継続しないこと、戻った画面で削除を自動実行しないことを確認する。Googleは `prompt=select_account consent`、GitHubは `prompt=select_account` を使う。既存のprovider sessionがある場合のパスワード/MFA再入力は保証しないため、放置端末に対する認証強度を実画面で評価し、公開前に受入方針を決める。[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)、[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)

端末tokenでprivacy/manual/delete APIを呼び403、AからBのsession/article stateへ操作して拒否、revoked tokenで401を確認する。拒否後のBの統計増分は0。照合は合成QAデータだけで行う。

## ST-03: HTTPSと秘密・cache境界

検証配備は`ENVIRONMENT=production`、実HTTPSの`API_ORIGIN`/`DASHBOARD_ORIGIN`、独立した十分なランダム`SESSION_SECRET`、強いDB資格情報を使う。現実装はproductionでHTTPS origins/SESSION_SECRET/PGが欠けると起動を拒否する。proxy/TLS終端、SPA route fallback、API path、DB永続化、複数worker時のproxy側rate limit、backup保存先をrunbookへ固定する。開発用HTTP localhost/10.0.2.2、`wikimf.example`、QA provider adapterを配布接続先として使わない。

実HTTPSでWeb session/OAuth cookieのSecure/HttpOnly/SameSite/path、異origin CORS、CSRF欠落/改変403、公開routeと`/me`のresponse分離、no-storeを確認する。CDN/proxyが私的APIをcacheしない設定も確認する。A logout→B login→browser back、offline cache、再読み込みでAのデータが出ないことを保存する。

合成canaryのtoken/検索語を使い、proxy/access/errorログ、Backend例外、logcat/crash、browser console、export、APK/JS bundleを走査する。実secretを検索文字列やレポートに残さず、漏洩の有無と対象ファイルだけを保存する。本文、fragment、referrer、URL queryの不要なログも対象にする。独立した非公式サービスであること、privacy/保持/削除/ライセンス導線を確認する。

## ST-04: 配布物・署名・更新

運用者がAndroid application ID、version、署名鍵の保管/backup、閉じたAPK配布かStore方式かを固定する。現在の`org.wikimf.reader`/debug keyは開発用で、release署名は未実施。releaseのAPI URLを設定しdebuggable/WebView debugging/cleartext例外を検査する。署名APK/AABの証明書digestを記録し、鍵/passwordはartifactへ含めない。[Android署名](https://developer.android.com/studio/publish/app-signing)

同じ署名・application IDで旧版→新版を更新し、owner/device/consent/暗号化credential/SQLite queue/履歴が意図どおり残ることを確認する。初回install、失効→再連携、別account、アンインストール前の未送信説明も確認する。debug署名版から異なるrelease署名版へ上書きできると仮定しない。

拡張はHTTPS originsでbuildし、最小権限、incognito無効、remote codeなしをmanifest/bundleで確認する。Developer modeで最終配布フォルダを読み込み、実IDを記録する。同じpathでreload/updateした場合のqueue/設定維持と、ID変更/削除によるstorage消失を説明する。安定したIDが必要な配布ではpublic keyと管理方式を固定する。[Chrome extension ID/key](https://developer.chrome.com/docs/extensions/reference/manifest/key)

最終SHA、schema_version、tracker/policy/client version、接続先origin、artifact hash、Android証明書digest、拡張IDを1つのmanifestで対応付ける。Store登録/アップロード/公開は別の依頼と資格情報が揃った時に行い、未申請を公開済みと記録しない。

## ST-05: Android Readerとfocus/lifecycle

API35 emulatorを先行し、物理端末で後日同じ操作を繰り返す。OS/API、WebView package/version、画面幅、IME、APK hashを記録する。linked QA userでクラウド収集とnative cloud consentをそれぞれONにし、実日英記事を開く。

Native SearchからReaderへ戻った際のfocus復帰、同session/位置維持はAPI35で確認済み。専用[ReaderFocusRegressionTest](../../apps/android/app/src/androidTest/java/org/wikimf/reader/ReaderFocusRegressionTest.kt)も`native_smoke=true`を明示し実APIのそのsessionで10秒以上の正activeを確認した。物理端末と関係する変更後にもこの経路を確認する。共通coreのfocus条件を弱めて合格にしない。通常instrumentationの`OK (3 tests)`に含まれたskipをこの縦断の合格にしない。

API35ではEarth/Moonのnative前後、同記事anchor、Search往復、回転後の位置/履歴、Home background停止を確認済み。追加でJA→EN→別記事の3記事、OS back/履歴なし、Account往復の位置、文字サイズ、screen lock、force-stop/reboot、process復帰を操作する。URL、scroll、session_id、seq、停止区間、queue/ACK、Dashboard値を照合する。回転でActivity再作成ごとに新sessionを観測したため、不要reload/同時session/二重計上の条件も確認する。外部HTTPS/target=_blank/不許可scheme/偽host/userinfo、Wikimedia画像、SSL cancel、renderer kill/retryも確認する。安全なbridge非対応WebViewはReaderだけ動作し、計測不可の説明が出ることを確認する。

再現可能なローカルcommandは[Android README](../../apps/android/README.md)のbuild/test-device手順を使う。UTP収集エラー時は実adb instrumentation出力で判定し、起動だけを完了にしない。

## ST-06: Native検索

日英で空入力の2履歴、1文字300ms debounce、確定前IME抑制、Enter/IME検索の本文検索、候補/結果選択、再選択先頭移動を順に試す。候補だけ表示→閉じるではsearched履歴差分0、開いた時だけ1件。local consent前は保存0。既定言語変更は次回検索だけに効き現在のReader URLは維持する。

遅いJA応答の間にENへ切替→JA応答を最後に返す。cancel/full検索も混ぜ、最新世代以外が画面を書き換えないことを確認する。0件、500、offline、429+Retry-Afterを区別し、履歴からの選択と再試行を確認する。説明なし/長title/HTML excerptのfixture、狭幅/大文字で表示と実行0を確認する。owner Aの履歴削除→再open/再起動→B連携でも混入0を確認する。ネットワークtraceを保存する場合はqueryを匿名化し不要な本文を含めない。

## ST-07: 両hostの縦断と計算

ChromeとAndroidのWeb承認、実tracker→owner/device Outbox→個別ACK→実PG→同owner Dashboard表示は確認済み。次は実provider/実MediaWiki metadataを使い、JA/ENのURLと正規wiki/page_id/article_id、source、session/seq、Document fingerprint、interval/active spans、state/cover/timeを照合する。既存の合成identity/metadataを置換したか明記する。

5秒、9,999/10,000ms、30秒と必要cover、80%と必要時間、抽出0/time_onlyを固定入力試験と実操作で分けて確認する。別session各50%はcompletedに合成しない。本文変更で新Document/session、同本文DOM差替えは計測を維持。再読は活動/時間だけ増え記事種類数不変、JA/EN同主題は別記事。PC/Androidを30秒ずらした60秒ずつの入力は90秒unionになることを確認し、実2host同時利用でも二重加算を確認する。

Tokyo午前0時、UTC、New YorkのDST切替前後、長区間、重複した日跨ぎを確認し、日別時間/文字増分の合計と総計を照合する。Resolverはcurid/title URL/ID逆引き、通常colon記事、redirect/移動/missing/期限切れcacheを実APIで試す。70秒静読は60秒以後の過小評価を再現し、説明とinteraction再開を確認する。実際に読んだ文字数の正解を既存係数から逆算しない。

## ST-08: 実Chrome host

既存C1/C2はGoogle Chrome 154.0.8037.93の実unpacked確認済み。最終artifactで追加の2window/2tab、非wiki tab、他app focus、最小化、lock/sleep、BFCache前後を操作し、同時active hostは1つで停止時間が増えないことを確認する。workerを実停止してから同Documentで続け、trusted binding復元と新観測を確認する。

End jump、非常に長い段落、zoom/resize、モバイル表示・折りたたみ/再展開、画像load/reflow、dynamic本文変更、anchor移動、oldid/diff/search/namespace頁、正常colon/curidを試す。未表示の中間chunk、未展開本文をcoverに含めず、同記事anchorでsessionを増やさないことを確認する。contentからcredential storage、任意URL fetch、偽popup/subframe/incognito senderへの否定試験を最終buildで行う。

## ST-09: queueと配送障害

QA専用user/端末だけを使い、元queueを保ったまま次を1条件ずつ注入する。保存event_id/payloadとACKの一致、集計増分、quarantine/rejected/lost数、停止表示を保存する。

1. offlineで保存→実worker stop / Android force-stop→再open→online。保存済みpayload/owner/deviceを変えず送る。
2. サーバcommit後にresponseだけ捨てる→同ID再送duplicate。受理/duplicateだけ消え、missing/retryableは残りterminalは隔離する。
3. seq逆転、open/closed欠落、同ID内容改変、異なるevent並行送信、413分割/単件隔離、422、429 Retry-After、5xxを試す。
4. revoke/expired token、A→B変更、同user別device、foreign session/3記事IDの1箇所改変を試す。Aの保存queueをB資格情報で送らず統計増分0を確認する。
5. Chrome8MiB、Android10MiB、7日境界、実storage quota/disk書込み失敗を再現する。無言上書きせず収集停止/可視通知、既存queue不変を確認する。
6. future+5分境界、past7日超、時計の前進/後退とtick gapを確認する。削除後にクライアント時計が前進した旧eventを送っても再作成しない。

ネットワークtrace/storage診断にはtoken/本文/検索語を出さない。必要な時間範囲、ID、status/code、件数のみ保存する。

## ST-10: privacyと削除

同意前はguest閲覧だけ、local/cloud同意は独立、停止時の未送信は「残す/送る/捨てる」の選択どおりになることを両hostで確認する。unlink前に同期または明示discard、再連携時の新cloud consentも確認する。

offline旧queueを残してWebから記事履歴削除、全履歴削除(epoch更新)、account削除を別userで実行する。online復帰/replay/再計算/backup復元後も削除履歴・manual・旧token・解除identityが復活しないことを確認する。削除後の新sessionは新controlに従って開始する。自分以外の操作、端末scope管理操作は拒否する。

manual-only変更/解除で時間・文字・自動称号を作らないことを確認する。private URL匿名アクセス、公開時間/称号の個別許可、非公開化、A/B切替cache、export秘密値除外を確認する。MVP-Aにはfeedを実装していないため、manual変更から記事title/履歴の公開副作用がない境界を確認し、M11フィード実装の完了と混同しない。

## ST-11: migration・復旧

空DB migrationに加え、QAデータを持つ0002から0004へのupgrade、履歴の保持、連携待ちcodeの失効、既存Web sessionの再認証要求、実PG dump/restore後の削除/失効safety適用を14項目で確認済み。[verify_recovery.py](../../scripts/verify_recovery.py)の[追加report](evidence/issues-14-18-recovery.json)を参照する。検証配備先ではbackup運用・復旧時間とreplay照合を追加で確認する。

別databaseでbackupを採取→書込み/削除/identity解除/epoch更新→最新safety ledgerを保存→古いbackupを復元→最新safety適用→replayを実行する。backupに存在しなかった記事に関する削除markerも安全に扱う。旧token/Web sessionの拒否、manual非復活、collection/publication OFF、再開の明示同意を確認する。削除台帳もbackupと同時点に戻すだけでは削除復活を防げない。

migration途中失敗・DB接続失敗を注入し、書込みを止めた状態からbackupとrunbookで復旧する。保持データに対する破壊的downgradeを自動の復旧策にしない。RPO/RTO、backup暗号化/保管権限、削除ledger保管、保持期間・job実装の担当を記録する。閉じた検証はraw event保持、正式運用の90日案は確定前であることを説明する。

## ST-12: 性能と自己利用

local PG/HTTP TestClientの500session条件では個人画面p95最大219.73msを確認済み。次はTLS/WAN/並行負荷と実端末で検索response/体感待ち、tracker抽出/scroll、長段落/5000chunk、複数端末、replay個人画面APIを測る。cache hit API p95 500ms未満は設計上の目標であり、件数・履歴量・DB/CPU/network・warmup・並行数・sample数を固定したreportで判定する。Wの2ページ抽出26.8/38.5msやlocal API測定だけをWAN性能やmobile電池保証に使わない。

大文字、dark、遅回線、background、静読70秒、短い記事、数式/表/箇条書き、モバイル折りたたみを含める。idle60秒による過小評価と分割読書の限界を説明し、理解できたか/読書を妨げたかを記録する。自己利用は実機1台で3〜7日とし、実際の開始/終了/利用回数/未利用日を記す。閾値を変える場合は新policy versionとして別検証し、旧履歴へ無言適用しない。

## ST-13: 最終照合と終了条件

追加修正後の配布source `dd575fb3362a43ca00043248bddf9dcca190c385`のremote CI全4jobは成功済み。PG95/JVM10/Native8+pairing1、実Chrome、復旧14項目と3artifactのhash/build対応を[追加検証記録](issue-fixes-dashboard.md)に固定した。旧M10 source `51d3360`の証跡は履歴として保持する。後日のSTで修正があれば、契約生成差分、実PG suite、shared tracker/拡張suite、Dashboard build/fixture/real API、Android unit/lint/build/instrumentation、実Chrome suite、復旧を変更の影響に応じて再実行する。provider/TLS/物理端末の未実施はskip理由とともに残す。CIのunit/build成功を実providerやbrowser/emulatorの確認へ広げない。

[受入台帳](acceptance-matrix.md)70行とG00～G10を結果で更新し、証跡が最終SHA/配布hashへ対応していることを照合する。重大な漏洩・二重計上・削除復活・検索/戻るの破綻は閉じた検証でも阻止条件。限定検証が可能な状態と、HTTPS/実OAuth/署名/物理端末を含めたリリース受入完了を分けて判定する。M11～M12のfeed/Neighbours/RaceはMVP-Aの残件に混ぜず別バックログにする。

## 証跡テンプレート

```text
ST-ID / 受入ID:
source SHA / artifact hash / schema・tracker・policy version:
OS / device・emulator / Chrome・WebView / PG / 接続先origin:
fixture範囲（identity/provider/metadata/network/clock）:
操作・入力・期待値:
実際のstatus/code/件数/時間/状態:
結果: pass / fail / skip（理由）
匿名化したreport/画像パス:
修正後の再実行範囲と結果:
残る制約:
```

token/cookie/secret、検索語、本文、個人情報を証跡へ添付しない。合成userの内部IDや集計値で実経路を照合し、必要な画面は匿名化する。
