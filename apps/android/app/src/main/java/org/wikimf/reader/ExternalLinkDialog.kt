package org.wikimf.reader

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import java.net.URI

/** The existing destination policy also gates the confirmation action. */
@Composable internal fun ExternalLinkDialog(url: String, onOpen: (String) -> Unit, onCancel: () -> Unit) {
    val destination = UrlPolicy.classify(url)
    val valid = destination != UrlPolicy.Destination.REJECT
    val host = if (valid) runCatching { URI(url).host }.getOrNull() else null
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("ブラウザでリンクを開きますか？") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("リンク先: ${host ?: "確認できないリンク"}")
                SelectionContainer { Text(url) }
                Text(when (destination) {
                    UrlPolicy.Destination.READER -> "このWikipediaのページを端末のブラウザで開きます。"
                    UrlPolicy.Destination.EXTERNAL -> "このリンクはReaderの対象外のため、端末のブラウザへ移動して開きます。"
                    UrlPolicy.Destination.REJECT -> "安全なリンク先を確認できないため、このリンクは開けません。"
                })
                if (valid) {
                    Text("移動している間は、このアプリの読書計測を一時停止します。")
                    Text("wikimfへ戻るには、端末の「戻る」操作かアプリ切り替えを使ってください。")
                }
            }
        },
        confirmButton = { TextButton(enabled = valid, onClick = { if (UrlPolicy.classify(url) != UrlPolicy.Destination.REJECT) onOpen(url) }) { Text("ブラウザで開く") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("キャンセル") } }
    )
}
