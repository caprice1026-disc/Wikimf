# 読書判定と同期表示の実機フィードバックを修正する

この ExecPlan は PLANS.md に従う生きた文書である。Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を更新する。作業場所は C:/Users/81905/Downloads/div/Wikimf。ユーザーは修正・LAN/Origin修正の main 取り込み・通常の push を承認した。force push、実機ADB、アプリのアンインストール、Docker容量回収は行わない。

## Purpose / Big Picture

Android Account のキュー件数を現在値で一度だけ表示し、同期完了後に自動更新する。Dashboard は記事の現在の手動状態を主表示し、個別の読書回の自動推定を区別する。本文の露出を1.8秒で計測し、速読者へ文字数に比例する待ち時間を要求しない。既存の読書時間、認証、未送信、手動設定を保持する。同じ applicationId・証明書で versionCode を上げた LAN APK を配布する。

## Progress

- [x] (2026-10-12) checkoutは変更なし、origin/mainは1d3f7db、作業ブランチfeat/lan-verificationは40a3f08。mainとの差分は既存LAN/Origin構成のみ。AGENTS/PLANSを確認した。
- [x] (2026-10-12) Issue13/29/7を確認。HTTPS配備29は将来用で、今回実装を開始しない。LANと本番HTTPS/OAuthの境界を保持する。
- [x] (2026-10-12) 同期二重表示、manual/articleとsessionの状態差、fixed600字/分、1秒採取/2秒露出を診断した。旧CI APKとローカルの署名が異なることを確認した。
- [ ] キュー現在値・同期状態をリアクティブに表示し、同期完了・queue増加・所有者変更を検証する。
- [ ] 現在の記事状態と過去の自動推定をAPI/GUIで分け、手動設定と解除、再閲覧の回帰を確認する。
- [ ] reading-v2の1.8秒計測、採取と境界flush、読了条件、v1/v2共存、既存データ再投影を検証する。
- [ ] 全チェック、同署名の上書きAPK、exact commit CI、mainへの通常pushと稼働更新を完了する。

## Surprises & Discoveries

Account は Settings.status 内の保存済み件数と LocalStore の現在件数を併記していた。sync_status 変更とqueue ACKだけでは画面が更新されない。送信障害そのものはユーザーが改善を確認しており、故障と断定しない。

記事の100%表示でも、固定600字/分による80%相当時間に不足すると partial になる。文字数比例の時間条件を除去しても、画面に表示されたことは内容理解の証明にならないため、表示は自動推定のままとする。

CIは毎回debug.keystoreを生成した。旧5f69887 CI APKの証明書は70ba5c3ce892becf8e821f6569704a618342aedf3b08e7538153c643425f352b、ローカル鍵は4ccaa93feab14719472bb0bf42707e79027b8ec16f88aef576cf4ac8b8612519。APKから秘密鍵は復元できない。実機の導入元/旧鍵の可用性が未確認であり、異なる証明書のAPKを上書き可能と案内しない。

## Decision Log

2026-10-12: 同期の説明とキュー件数を分離し、現在件数を唯一の表示源にする。queueの書込み/ACK/隔離/破棄と同期状態の変更をUIへ通知する。既存の保存済み文章も現在表示へ移行し、ユーザーのOutboxを消さない。

2026-10-12: activitiesのstateは過去の自動推定として保持し、articleのeffective/manual状態を追加して主表示する。手動指定は自動推定の変更や再閲覧で上書きせず、解除すると現在の自動推定へ戻る。

2026-10-12: 採用候補は読了=本文coverage80%以上かつactive30秒以上。文字数比例の最低時間は除く。1.8秒の露出と短時間閲覧の除外は残す。意図的に全体をスクロールして表示したことを読書として推定する可能性は残り、本文理解を保証しない。親にルールとトレードオフを先に報告する。

2026-10-12: measurementはreading-v2、judgementの版も明示する。旧v1/v2のイベントは両方受理し、既存のimmutableなイベント/時刻/coverage/同意を変更しない。旧v1の2秒露出はv2の1.8秒以上の証拠として使えるので、現在の自動判定は既存データもv2で再投影する。manual overrideは優先。推定文字数の計算は今回別途変えず、読了の条件から分離する。

2026-10-12: 200ms程度の採取と表示/離脱境界の採取で1.8秒の実時間積算を検証する。未採取の背景/idle/sleepを読書時間へ足さず、時計逆行と長い停止の既存保護を維持する。境界で新DOM/旧セッションを混ぜない。

## Outcomes & Retrospective

開始時点。remote mainに他者の新しいcommitはない。署名の継続性は未確定だが、ソース修正・テストは進める。サービスの変更は短時間でも親へ事前通知し、ユーザーの実機テストを妨げない。

## Context and Orientation

apps/android/app/src/main/java/org/wikimf/reader/Storage.ktは設定と端末内Outbox、Api.ktはACK後削除とWorkManager同期、MainActivity.ktのAccountScreenは表示を担う。queueの通知は実データを渡さず再読取りの合図だけを送る。

apps/backend/wikimf/projection.pyは受理済みイベントから時間と状態を都度計算する。recordsは記事の現在状態、activitiesは読書の各回を表す。main.pyの/me/articlesと/me/activitiesがそれぞれを返し、Dashboard components.tsxのReadingRowは後者を表示する。

packages/tracker/tracker.jsはChromeとAndroidに共通の本文計測で、android-adapter.jsと拡張のadapterが表示・背景切替を伝える。contracts.pyと拡張/Androidのvalidatorは旧queueと新版のイベントを受理する必要がある。設計書docs/wikimf-detailed-design-v0.1.md等にも変更の版と既存データの扱いを記録する。

## Plan of Work

最初にUIのキュー表示源を統一し、設定状態とSQLiteの変更から更新できる小さな通知を追加する。実SQLiteと同期ACK後の画面更新を検証する。次に同じ投影snapshotからarticleの現在状態をactivityへ付加し、主表示と過去の自動推定を明示する。

第三に共有trackerとbackendの判定を一致させる。1.8秒の直前/直後、速い移動、最後の端数、background/idle/sleep、時計逆行、重複/ACK/停止をテストする。v1 queueを失わずv2と併存できるよう入力validatorと契約を更新する。判定に必要な理由を表示し、測定時間は変更しない。

最後にversionCodeを2より増加し、実機の旧署名を確認した同じ鍵でLAN APKを作る。CI生成鍵だけのartifactは既存実機の更新用と扱わない。通常push前にmainをfetchし、変更があれば保持してmerge・再検証する。保護されたmainを迂回しない。

## Concrete Steps

repo rootからローカルの.venvとNode24、apps/android/build.ps1のJDK17/Gradle8.9/SDK35を使う。

    python scripts/generate_contracts.py --check
    python -m pytest -q -p no:cacheprovider
    npm --prefix packages/tracker test
    npm --prefix packages/tracker run build
    npm --prefix apps/extension test
    npm --prefix apps/extension run build
    npm --prefix apps/dashboard run test:unit
    npm --prefix apps/dashboard run build
    powershell apps/android/build.ps1 -Tasks testDebugUnitTest,testLanUnitTest,testReleaseUnitTest,assembleLan,assembleRelease,lintDebug,lintLan,lintRelease

PowerShell配列の実呼出しは対話shellで -Tasks @('testDebugUnitTest',...) を使う。PostgreSQLとbrowser/emulatorの全回帰はexact commit CIで確認し、必要なローカル統合テストは分離schema/projectだけを使う。秘密と実読書履歴は公開証跡にしない。

## Validation and Acceptance

ACK後にAccountを開き直さず現在キューが0へ変わり、二重の件数がない。queue追加・隔離・所有者変更も現在値を表示する。manual completedにするとLibrary/Overview双方が読了・手動を示し、過去の自動推定は別ラベル。viewedへ変更/手動解除/再閲覧でも意図どおりの状態になる。

露出1799msは未計測、1800msは計測で、半分未満/高速jump/隠れた本文を水増ししない。全coverageでも30秒未満は読了にしない。80%かつ30秒で本文長に関係なく読了。旧v1と新v2を再送して二重計上せず、手動状態と時間を保持する。

LAN APKはorg.wikimf.reader.lan、非debug、private HTTPのみ。本番releaseはHTTPS制限を維持する。旧APKと新APKの証明書一致、versionCode増加、署名検証を入手前に確認し、アンインストールなし更新後も認証/queue/履歴が残ることをユーザーが確認する。

## Idempotence and Recovery

新判定は読取り時の再計算でありrawイベントを更新しない。rollbackしても測定時間と手動状態は残るが、新v2イベントを旧validatorが拒否しないよう戻す範囲を制限する。volume/credential/ユーザーデータを削除しない。mainへのforce pushはしない。署名鍵が欠ける場合は上書き可能と偽って配布しない。

## Artifacts and Notes

実装・試験の簡潔な証跡とsource/CI/APK hashを記録する。APKの秘密鍵や実ログイントークン、端末コード、実読書履歴はGit・ログ・外部へ保存しない。Docker圧縮は未承認で保留。

## Interfaces and Dependencies

新規の本番依存は追加しない。既存Compose/Coroutines/SQLite/SharedPreferences、stdlib、SQLAlchemy、Playwright、JUnitを使う。新APIフィールドは既存stateの意味を変えず、articleの現在状態を追加する。既存Outbox DB schemaを維持する。

更新記録: 2026-10-12、実機フィードバック4点とmain push承認、署名継続性の条件を最初の実装計画へ反映した。

2026-10-12追加決定: 日本語推定上限1800/分、英語1000維持。API追加やcoveragechars主表示への置換は行わない。ユーザーは公式エミュレータ+API35+専用AVD追加5〜8GBを許可、既存ライセンス/ハイパーバイザーのみ使用。Issue31〜36へ分割起票、エミュレータで該当確認前はopenを維持。

2026-10-12検証: tracker20件、extension50件、Dashboardブラウザ26フロー/単体/build、backend136件SQLite（PG専用7件はCIで実行）、Android debug/LAN/release単体・全lint/APK成功。専用WHPX/API35エミュレータでSyncUi/SyncRetry/API/ReaderLifecycle/Privacy/Control17件成功。503/429→保持→duplicateACK検証、実機原因は未確定。
