package org.wikimf.reader

import org.junit.Assert.*
import org.junit.Test

class SyncUiTest {
    @Test fun currentUnsentQueueTakesPriorityOverPreviousSuccess() {
        for (saved in listOf("前回の同期完了", "同期済み0件・隔離0件")) {
            assertEquals("未送信の記録があります（同期待ち）", syncStatusMessage(saved, queued=6))
            assertEquals("前回の同期は完了しています。現在の未送信記録はまだ同期されていません。", previousSyncNote(saved,6))
        }
        assertEquals("前回の同期完了", syncStatusMessage("前回の同期完了",queued=0))
        assertNull(previousSyncNote("前回の同期完了",0))
    }
    @Test fun stoppedRecordingAndCurrentFailuresRemainVisibleWithQueuedEvents() {
        assertEquals("クラウド記録停止中（未送信を端末で保持）",syncStatusMessage("前回の同期完了",6,cloudConsent=false))
        assertEquals("クラウド記録停止中（未送信を端末で保持）",syncStatusMessage("前回の同期完了",6,serverEnabled=false))
        val failure=syncFailureMessage(ApiFailure(503,"wikipedia_unavailable"))
        assertEquals(failure,syncStatusMessage(failure,6))
        assertNull(previousSyncNote(failure,6))
        assertEquals("同期中",syncStatusMessage("同期中",6))
        assertEquals("端末連携を確認してください",syncStatusMessage("端末連携を確認してください",6))
    }
    @Test fun remainingQuarantineIsVisibleAfterUnsentEventsDrain() {
        assertEquals("未送信の記録があります（同期待ち）",syncStatusMessage("前回の同期完了",1,2))
        assertEquals("隔離された記録があります",syncStatusMessage("前回の同期完了",0,2))
    }
    @Test fun readerGuidanceDistinguishesLinkConsentCollectionAndExplicitPause() {
        for (linked in listOf(false,true)) for (consent in listOf(false,true)) for (collection in listOf(false,true)) {
            assertEquals("記録一時停止中",recordingStatusMessage(linked,consent,collection,true))
            val message=recordingStatusMessage(linked,consent,collection,false)
            when {
                !linked -> assertTrue(message.contains("端末を連携"))
                !consent -> { assertTrue(message.contains("端末は連携済み"));assertTrue(message.contains("読書記録に同意"));assertFalse(message.contains("端末を連携")) }
                !collection -> assertEquals("クラウド収集はDashboardで有効にしてください",message)
                else -> assertEquals("",message)
            }
        }
    }
    @Test fun legacySavedCountsNeverCompeteWithLiveCounts() {
        assertEquals("前回の同期結果", syncStatusMessage("未送信0件・隔離0件"))
        assertEquals("クラウド記録停止中", syncStatusMessage("クラウド記録停止中・未送信2件を端末で保持"))
        assertEquals("隔離された記録があります", syncStatusMessage("隔離された記録 2件"))
        assertEquals("同期保留（再試行可能）", syncStatusMessage("同期保留・2件（再試行可能）"))
        assertEquals("端末連携を確認してください", syncStatusMessage("端末連携を確認してください"))
    }
    @Test fun retryReasonsAreSafeAndKeepTheCurrentDiagnostic() {
        val unavailable = syncFailureMessage(ApiFailure(503,"wikipedia_unavailable"))
        assertEquals(unavailable, syncStatusMessage(unavailable))
        assertTrue(unavailable.contains("HTTP503"))
        assertTrue(syncFailureMessage(ApiFailure(429,"rate_limited")).contains("HTTP429"))
        assertFalse(syncFailureMessage(ApiFailure(503,"https://secret.example/token")).contains("secret"))
        assertFalse(syncFailureMessage(java.io.IOException("sensitive body")).contains("sensitive"))
        assertTrue(syncFailureMessage(java.net.SocketTimeoutException()).contains("タイムアウト"))
    }
}
