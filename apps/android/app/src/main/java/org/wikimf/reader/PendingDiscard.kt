package org.wikimf.reader

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** IDs only: a confirmation never copies private reading payloads into UI state. */
internal data class PendingDiscardSnapshot(val owner: String, val events: Set<String>, val diagnostics: Set<String>)

internal class PendingDiscardConfirmation(val deviceId: String, val snapshot: PendingDiscardSnapshot) {
    private var decided = false
    @Synchronized fun claim(): Boolean {
        if (decided) return false
        decided = true
        return true
    }
}

/** Recheck both the binding and recording permission before a destructive local operation. */
internal fun confirmPendingDiscard(settings: Settings, store: LocalStore, confirmation: PendingDiscardConfirmation): Boolean {
    if (!confirmation.claim()) return false
    return settings.recordingLocked {
        val device = settings.device()
        if (device == null || device.deviceId != confirmation.deviceId || device.userId != confirmation.snapshot.owner ||
            (settings.cloudConsent && settings.serverEnabled)) false
        else store.discardConfirmed(confirmation.snapshot)
    }
}

@Composable internal fun PendingDiscardDialog(
    confirmation: PendingDiscardConfirmation, deviceName: String, onConfirm: () -> Unit, onCancel: () -> Unit
) {
    fun cancel() { if (confirmation.claim()) onCancel() }
    val snapshot = confirmation.snapshot
    AlertDialog(
        onDismissRequest = ::cancel,
        title = { Text("未送信記録を破棄しますか？") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("対象: この端末の「$deviceName」として連携した読書記録")
                Text("未送信 ${snapshot.events.size}件・隔離 ${snapshot.diagnostics.size}件")
                Text("未送信の読書時間・本文カバー率などの記録が端末から削除され、クラウドへ送れなくなります。元に戻せません。隔離された診断も削除されます。")
                Text("端末の記事履歴と、送信済みのクラウド記録は消えません。")
            }
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("破棄する") } },
        dismissButton = { TextButton(onClick = ::cancel) { Text("キャンセル") } }
    )
}
