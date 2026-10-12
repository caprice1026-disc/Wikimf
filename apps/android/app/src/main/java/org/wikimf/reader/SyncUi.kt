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

internal fun syncStatusMessage(saved: String): String = when {
    saved.startsWith("クラウド記録停止中") -> "クラウド記録停止中"
    saved.startsWith("同期保留") && saved.contains("件") -> "同期保留（再試行可能）"
    saved.startsWith("隔離された記録") -> "隔離された記録があります"
    saved.startsWith("未送信") -> "前回の同期結果"
    else -> saved
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
