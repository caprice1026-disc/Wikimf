package org.wikimf.reader

import org.junit.Assert.*
import org.junit.Test

class SyncUiTest {
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
