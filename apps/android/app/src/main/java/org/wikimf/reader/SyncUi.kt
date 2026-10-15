package org.wikimf.reader

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

// A notification only: queue contents and credentials never enter this stream.
internal object SyncUiUpdates {
    private val revision = MutableStateFlow(0L)
    val changes = revision.asStateFlow()
    fun changed() { revision.update { it + 1 } }
}

internal fun syncStatusMessage(saved: String, queued: Int = 0, quarantined: Int = 0, cloudConsent: Boolean = true, serverEnabled: Boolean = true): String = when {
    !cloudConsent || !serverEnabled -> if (queued > 0) "クラウド記録停止中（未送信を端末で保持）" else "クラウド記録停止中"
    saved == "端末連携を確認してください" -> saved
    saved == "同期中" -> saved
    saved.startsWith("同期保留") && saved.contains("件") -> "同期保留（再試行可能）"
    saved.startsWith("同期保留") -> saved
    queued > 0 -> "未送信の記録があります（同期待ち）"
    quarantined > 0 -> "隔離された記録があります"
    saved.startsWith("クラウド記録停止中") -> "クラウド記録停止中"
    saved.startsWith("隔離された記録") -> "隔離された記録があります"
    saved.startsWith("未送信") -> "前回の同期結果"
    else -> saved
}

internal fun previousSyncNote(saved: String, queued: Int): String? =
    if (queued > 0 && (saved == "前回の同期完了" || saved.startsWith("同期済み")))
        "前回の同期は完了しています。現在の未送信記録はまだ同期されていません。"
    else null

internal fun recordingStatusMessage(linked: Boolean, cloudConsent: Boolean, serverEnabled: Boolean, paused: Boolean): String = when {
    paused -> "記録一時停止中"
    !linked -> "クラウド記録はAccountで端末を連携し、読書記録に同意すると開始します"
    !cloudConsent -> "端末は連携済みです。記録を開始するにはAccountで「クラウド読書記録に同意」をONにしてください"
    !serverEnabled -> "クラウド収集はDashboardで有効にしてください"
    else -> ""
}


/** Never show raw exception messages, URLs, tokens, or server response bodies. */
internal fun syncFailureMessage(failure: Exception): String {
    val reason = when (failure) {
        is ApiFailure -> "HTTP${failure.code}: " + failure.errorCode.takeIf { it.matches(Regex("[a-z0-9_]{1,60}")) }.orEmpty().ifBlank { "api_error" }
        is java.io.InterruptedIOException -> "通信タイムアウト"
        is java.io.IOException -> "通信エラー"
        else -> "応答の処理エラー"
    }
    return "同期保留（$reason、再試行可能）"
}
