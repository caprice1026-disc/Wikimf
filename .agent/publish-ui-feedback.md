# 保存済みUI改善をmainとLAN検証Releaseへ公開する

PLANS.mdに従う日本語ExecPlan。ユーザーは2026-10-15にmain pushと新しいReleaseへのAPK/拡張ZIP/導入説明/checksum公開を明示承認した。以前の未push・未公開の制限はこの作業で解除された。実LANサービス/DB、新しいChrome QA認証、失効キュー救済の実装は今回も操作しない。

## Purpose / Big Picture

Android v9（0.1.5-lan-local/code9）、Chrome期限注意までのv10、Dashboardの一覧復帰/表示修正をmainへ保存し、既存署名で更新できるLAN検証APKと同じ接続先のChrome拡張をGitHub Releaseから取得できるようにする。公開ダウンロードのSHA256とローカル成果物を照合する。公開はLAN検証用prereleaseであり、本番HTTPS/OAuth/実機/実Chrome連携の全面合格とはしない。

## Progress

- [x] AGENTS、保存済みdiff/manifestとremoteを確認。origin/main=c79746b、HEAD=6a1fef3で前進可能。競合なし、既存ファイル変更は保存済み作業と一致。
- [x] 公開対象31ファイルのstageと秘密除外を検査。旧公開code6と同じ署名/appId、code9、同じLAN origin、Chrome0.1.5と導入説明を確定。
- [x] 最終ローカル検証成功：Android3variant各29unit/lint/build、署名/HTTPS境界、tracker21、Chrome69unit/16DOM/11MV3/12queue、Dashboard26+10とunit/typecheck/build、Backend一時SQLite3。source commit準備完了。
- [ ] main/tagを非force pushしCIを確認、prereleaseへAPK/拡張ZIP/説明/checksumを添付する。
- [ ] 公開downloadのhashを照合し、URL/CI/未受入を報告する。

## Surprises & Discoveries

gh CLIはインストールされていない。既存Git credential helperの資格情報をプロセス内だけで利用するstdlib API helperを.tmpへ置く。tokenは表示/保存せず、api.github.comとuploads.github.comにのみ認証を付ける。download時の別host redirectには認証を渡さない。

既存package_release.pyは0.1.0/debug専用で今回の配布に適さない。配布用ディレクトリを新設し、検証済みlanLocal APK、許可リストの拡張buildファイル、READMEとmanifest/checksumだけを梱包する。QA向け127.0.0.1:18080のbuildを実利用者向けZIPへ流用しない。

## Decision Log

remote mainがHEADの祖先なら既存作業branchの確認済みcommitをmainへfast-forward pushする。force/reset/ユーザー変更破棄を使わない。公開前にsourceと配布設定を確定し、同一commitのCI成功後にdraftを公開する。保護ルールがあれば同じ変更でPRへ切り替え、チェックを尊重する。

署名鍵は既存apps/android/.tooling/debug.keystoreを使うlanLocal。appId org.wikimf.reader.lan.local、versionCode9を維持する。CIの一時署名APKや通常ST版をReleaseへ置かない。過去の異署名版からはアンインストールを誘導せず保持と移行注意を説明する。実LAN入口は配布済み設定を読んで合わせ、サービスの設定やDBを変更しない。

## Outcomes & Retrospective

ローカル最終検証は成功。再buildしたAPKは保存済みv9とbyte hashも一致し、旧公開APKの証明書も同じ4ccaa93f...だった。実LAN/DBを使わずに署名/ID/増加版を照合した。次にsourceをmainへ非force pushし、同じcommitのCI5jobと公開downloadを確認する。CIの一時DB/AVDと利用中の実LANを混同しない。

## Context and Orientation

root作業branch feat/lan-verificationは6a1fef3。19 tracked filesと追加テスト/設計記録が未commit。apps/android、apps/extension、apps/dashboardの既知変更を保存する。内部QA `.tmp`、鍵 `.tooling`、env、profile、実資格情報はGit/Releaseに含めない。docs/reviewsと古い作業記録はローカル履歴として保持し、公開に必要な検証/制約はdocs/releasesに簡潔に記す。

保存APKは.tmp/ui-feedback-20261013/v9-final/wikimf-0.1.5-lan-local.apk、SHA256 d7dddef55c377735279cee4908a8b6ac4a9c379b3b436d9c971525bc37db4d8f。証明書SHA256 4ccaa93feab14719472bb0bf42707e79027b8ec16f88aef576cf4ac8b8612519。Chrome最終source hashはv10-extension-final/handoff-manifest.json。履歴保持/実UI10、Chrome69unit/16DOM/11MV3/12queueとAstra6ケースを保存済み。新規Chrome QA連携と#4救済は未受入のまま。

## Plan of Work

まずGitHub既存Release/tag/接続先と認証可能性を読む。差分/新規ファイルの内容と秘密除外を確認する。公開説明とExecPlan、必要なcode/testだけを明示的にstageし、ローカルのその他の記録を保持する。

Androidのunit/lint/build、署名/ID/前版互換/HTTPS境界を確認する。Chrome69unitと実DOM/MV3/queue、Dashboard unit/build/一覧回帰、Backend新規の一時SQLite認証試験を実行する。実LAN/DBを使うローカル検証はしない。CIで全backend/isolated LANを確認する。配布Chromeは既存と同じprivate originでbuildし、ZIPを許可リストから作る。

sourceをcommitしてmainへpush後、同一SHAのCIを待ち、draft Releaseに正確な制約付き説明とファイルをuploadする。CI成功とasset hash/内容検査を満たしてからprerelease公開。匿名downloadを別ファイルへ保存し、APK/ZIP/README/manifest/checksumのbyteとSHA256を照合する。

## Concrete Steps

repo rootのPowerShell、同梱Node24、.venv Python、apps/android/build.ps1を使う。Gitは毎回 -c safe.directory=C:/Users/81905/Downloads/div/Wikimf を付ける。GitHub API helperとpublishの一時ファイルは.tmp/release-20261015へ保存する。

    git fetch origin
    git merge-base --is-ancestor origin/main HEAD
    ./.tooling/node-v24.21.0-win-x64/node.exe packages/tracker/build.js
    ./apps/android/build.ps1 -Tasks @('testDebugUnitTest','testLanLocalUnitTest','assembleLanLocal','assembleRelease','lintDebug','lintLanLocal','lintRelease','-x','bundleTracker')
    ./.venv/Scripts/python.exe scripts/verify_android_lan.py --variant lanLocal --expected-certificate 4ccaa93feab14719472bb0bf42707e79027b8ec16f88aef576cf4ac8b8612519 --previous-apk .tmp/ui-feedback-20261013/v8-final/wikimf-0.1.4-lan-local.apk

Gradleは必要時incremental=false/in-processを指定し、既存鍵がなければ代替生成をせず停止する。Chrome/DashboardのcwdとPlaywright runtimeは各既存scriptと保存手順を用いる。明示的なsource stage/commit後、push先を再確認してHEAD:refs/heads/mainへ非force pushする。

## Validation and Acceptance

ユーザー変更が残り、公開対象にenv/key/DB/profile/資格情報がない。APKは同じappId/certでcode9、通常releaseはHTTP拒否。Chrome ZIPに意図したorigin/permission/versionと固定buildファイルだけがある。Dashboardはsourceを公開するが実サービスには配備しない。GitHub main/tagが最終commitを指し5job成功、Releaseに指定assetと導入説明/checksumがあり、公開downloadのhashが一致する。

## Idempotence and Recovery

ネットワーク切断時はGit refs/CI/Release draft/asset一覧を読んでから続行し、同じtag/assetを重複作成しない。既存Releaseを書き換えず新tagを使う。ユーザーdataやworking treeをresetしない。公開済みassetの置換が必要なら同じ名前を黙って差し替えず、原因を示して新tag/版で扱う。

## Artifacts and Notes

最終配布とAPI操作の非秘密metadata/logは.tmp/release-20261015に保存する。公開する検証/導入説明はdocs/releasesに置き、旧「未公開」記録は当時の履歴として保持する。親への進捗はcommentaryと終端通知で渡す。

## Interfaces and Dependencies

追加ランタイム依存なし。Git、既存credential manager、Python標準urllib/json/hashlib/zipfile、Node24、JDK17/Gradle8.9/SDK35を使う。GitHub APIでは同一repoのrefs/runs/releases/assetsだけを扱い、秘密値を出力しない。
