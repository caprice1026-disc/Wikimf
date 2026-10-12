package org.wikimf.reader

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.take
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class SyncUiRegressionTest {
    @Test fun enqueueAckAndStatusPublishLiveCountsAcrossStoreInstances() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val reader = LocalStore(context)
        val worker = LocalStore(context)
        val owner = "sync-ui-test-${UUID.randomUUID()}"
        val id = UUID.randomUUID().toString()
        val device = LinkedDevice(owner, "fixture-device", "unused-fixture-token", "Fixture")
        val settings = Settings(context)
        val oldStatus = settings.status
        val snapshots = mutableListOf<Pair<Int,String>>()
        val listener = launch(start=CoroutineStart.UNDISPATCHED, context=Dispatchers.Unconfined) {
            SyncUiUpdates.changes.drop(1).take(3).collect { snapshots.add(reader.count(owner) to syncStatusMessage(settings.status)) }
        }
        try {
            assertTrue(worker.enqueue(device, JSONObject().put("event_id",id), null))
            settings.status = "前回の同期完了"
            worker.ack(id)
            withTimeout(2000) { listener.join() }
            assertEquals(listOf(1,1,0), snapshots.map { it.first })
            assertEquals("前回の同期完了", snapshots.last().second)
            assertFalse(snapshots.last().second.contains("未送信"))
        } finally {
            listener.cancelAndJoin(); worker.discard(owner); settings.status=oldStatus
            reader.close(); worker.close()
        }
    }
}
