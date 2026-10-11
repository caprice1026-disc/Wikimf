package org.wikimf.reader

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.LinkedBlockingQueue
import kotlin.coroutines.CoroutineContext

@RunWith(AndroidJUnit4::class)
class RecordingControlRegressionTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext.createDeviceProtectedStorageContext()
    private val device = LinkedDevice(UUID.randomUUID().toString(), UUID.randomUUID().toString(), "synthetic-token", "Fixture")
    private val article = "00000000-0000-4000-8000-000000000101"
    private fun markers() = JSONArray().put(JSONObject().put("article_id", article).put("deleted_before", "2026-10-01T00:00:00Z"))
    private fun control(epoch: Int, enabled: Boolean, markers: JSONArray = JSONArray(), owner: LinkedDevice = device) = MockResponse().setBody(
        JSONObject().put("user_id", owner.userId).put("device_id", owner.deviceId).put("recording_epoch", epoch)
            .put("collection_enabled", enabled).put("deletion_markers", markers).toString())
    private fun event(epoch: Int) = JSONObject().put("event_id", UUID.randomUUID().toString()).put("recording_epoch", epoch)
        .put("session_started_at", "2026-10-02T00:00:00Z").put("article_id", article)
    private suspend fun fixture(block: suspend (Settings, LocalStore, MockWebServer) -> Unit) {
        val settings = Settings(context)
        val oldApi = settings.apiUrl
        MockWebServer().use { server ->
            server.start()
            settings.apiUrl = server.url("/api/v1").toString()
            settings.saveDevice(device); settings.cloudConsent = true; settings.serverEnabled = true
            LocalStore(context).use { store ->
                try { block(settings, store, server) }
                finally { store.discard(device.userId); settings.unlink(); settings.apiUrl = oldApi }
            }
        }
    }

    @Test fun delayedOnAcrossApiAndSettingsInstancesCannotUndoOffOrDeleteNewEpochQueue() = runBlocking {
        fixture { settings, store, server ->
            server.enqueue(control(1, true).setBodyDelay(1, TimeUnit.SECONDS))
            server.enqueue(control(2, false, markers()))
            val old = async { runCatching { Api(Settings(context)).recordingControl(store, device) } }
            assertNotNull(withContext(Dispatchers.IO) { server.takeRequest(2, TimeUnit.SECONDS) })
            Api(Settings(context)).recordingControl(store, device)
            val fresh = event(2); assertTrue(store.enqueue(device, fresh, null))
            assertTrue(old.await().exceptionOrNull() is ApiFailure)
            assertFalse(settings.serverEnabled); assertEquals(2, settings.epoch)
            assertNotNull(settings.deletionCutoff(article))
            assertEquals(fresh.getString("event_id"), store.rows(device).single().id)
            assertEquals(0, store.quarantined(device.userId))
        }
    }

    @Test fun omittedMarkersAndLowerEpochCannotRegressPrivacyState() = runBlocking {
        fixture { settings, store, server ->
            server.enqueue(control(3, true, markers())); Api(settings).recordingControl(store, device)
            server.enqueue(control(3, true)); Api(Settings(context)).recordingControl(store, device)
            assertNotNull(settings.deletionCutoff(article))
            val fresh = event(3); assertTrue(store.enqueue(device, fresh, null))
            server.enqueue(control(2, false))
            val failed = runCatching { Api(settings).recordingControl(store, device) }.exceptionOrNull()
            assertEquals("recording_control_superseded", (failed as ApiFailure).errorCode)
            assertEquals(3, settings.epoch); assertTrue(settings.serverEnabled)
            store.discardEpoch(device.userId, 2)
            assertEquals(fresh.getString("event_id"), store.rows(device).single().id)
        }
    }

    @Test fun replacedOwnerOrCanceledControlCannotApplyItsResponse() = runBlocking {
        fixture { settings, store, server ->
            server.enqueue(control(99, false, markers()).setBodyDelay(1, TimeUnit.SECONDS))
            val old = async { runCatching { Api(settings).recordingControl(store, device) } }
            assertNotNull(withContext(Dispatchers.IO) { server.takeRequest(2, TimeUnit.SECONDS) })
            // Relinking the same credentials is still a different binding generation (ABA).
            Settings(context).saveDevice(device); settings.cloudConsent = true; settings.serverEnabled = true
            val fresh = event(1); assertTrue(store.enqueue(device, fresh, null))
            assertTrue(old.await().isFailure)
            assertEquals(1, settings.epoch); assertTrue(settings.serverEnabled); assertNull(settings.deletionCutoff(article))
            server.enqueue(control(8, false).setBodyDelay(1, TimeUnit.SECONDS))
            val canceled = launch { Api(settings).recordingControl(store, device) }
            assertNotNull(withContext(Dispatchers.IO) { server.takeRequest(2, TimeUnit.SECONDS) })
            canceled.cancelAndJoin(); delay(1100)
            assertEquals(1, settings.epoch); assertTrue(settings.serverEnabled)
            assertEquals(fresh.getString("event_id"), store.rows(device).single().id)
        }
    }

    @Test fun delayedAuthenticationFailureCannotDisableNewerAcceptedControl() = runBlocking {
        fixture { settings, store, server ->
            for (status in listOf(401, 403)) {
                server.enqueue(MockResponse().setResponseCode(status).setBody("{\"error\":{\"code\":\"revoked\"}}").setBodyDelay(1, TimeUnit.SECONDS))
                val old = async { runCatching { Api(Settings(context)).recordingControl(store, device) } }
                assertNotNull(withContext(Dispatchers.IO) { server.takeRequest(2, TimeUnit.SECONDS) })
                server.enqueue(control(2, true, markers()))
                Api(settings).recordingControl(store, device)
                // Drain the newer request so the next iteration waits for its own old request.
                assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
                val failure = old.await().exceptionOrNull() as ApiFailure
                assertEquals("recording_control_superseded", failure.errorCode)
                assertTrue(settings.serverEnabled); assertEquals(2, settings.epoch)
            }
        }
    }

    @Test fun workerFailureCannotTurnOffNewerControlOrReplacementOwner() = runBlocking {
        fixture { settings, store, server ->
            for (replaceOwner in listOf(false, true)) {
                server.enqueue(MockResponse().setResponseCode(403).setBody("{\"error\":{\"code\":\"revoked\"}}").setBodyDelay(1, TimeUnit.SECONDS))
                val worker = async(Dispatchers.IO) { SyncEngine(context).sync() }
                assertNotNull(withContext(Dispatchers.IO) { server.takeRequest(2, TimeUnit.SECONDS) })
                val current = if (replaceOwner) device.copy(userId = "replacement-${device.userId}", token = "replacement-token") else device
                if (replaceOwner) { settings.saveDevice(current); settings.cloudConsent = true }
                server.enqueue(control(2, true, markers(), current))
                Api(Settings(context)).recordingControl(store, current)
                assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
                val fresh = event(2); assertTrue(store.enqueue(current, fresh, null))
                worker.await()
                assertEquals(current, settings.device()); assertTrue(settings.serverEnabled); assertEquals(2, settings.epoch)
                assertTrue(store.rows(current).any { it.id == fresh.getString("event_id") })
                store.discard(current.userId)
            }
        }
    }

    @Test fun errorQueuedOnBusyDispatcherIsRevalidatedBeforeSyncCanHandleIt() = runBlocking {
        fixture { settings, store, server ->
            val dispatches = LinkedBlockingQueue<Runnable>()
            val dispatcher = object : CoroutineDispatcher() {
                override fun dispatch(context: CoroutineContext, block: Runnable) { dispatches.add(block) }
            }
            val http = OkHttpClient()
            try {
                for (status in listOf(401, 403, 0)) {
                    server.enqueue(control(1, true))
                    val snapshot = Api(settings).recordingControl(store, device)
                    if (status != 0) server.enqueue(MockResponse().setResponseCode(status).setBody("{\"error\":{\"code\":\"revoked\"}}"))
                    val client = if (status == 0) http.newBuilder().addInterceptor { throw java.io.IOException("fixture network failure") }.build() else http
                    val result = async(dispatcher) { runCatching { Api(settings, client).request("/reading-events/batch", JSONObject().put("events", JSONArray()), device, snapshot) } }
                    val start = dispatches.poll(3, TimeUnit.SECONDS); assertNotNull(start); start!!.run()
                    val pendingError = dispatches.poll(3, TimeUnit.SECONDS); assertNotNull(pendingError)
                    // The HTTP callback has finished, but its coroutine continuation is queued.
                    settings.saveControl(1, true, markers())
                    pendingError!!.run()
                    val failure = result.await().exceptionOrNull() as ApiFailure
                    assertEquals("recording_control_superseded", failure.errorCode)
                    assertTrue(settings.serverEnabled)
                    // Start the next iteration with a distinct revision too.
                    settings.saveControl(1, true, JSONArray())
                }
            } finally { http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll() }
        }
    }

    @Test fun queuedUrlAndOldBatchPermissionAreRejectedAfterNewControl() = runBlocking {
        fixture { settings, store, server ->
            val entered = CountDownLatch(1); val release = CountDownLatch(1)
            val http = OkHttpClient.Builder().addInterceptor { chain ->
                if (chain.request().url.encodedPath.endsWith("/articles/resolve")) {
                    entered.countDown(); check(release.await(5, TimeUnit.SECONDS))
                }
                chain.proceed(chain.request())
            }.build()
            try {
                server.enqueue(control(1, true))
                val api = Api(settings, http)
                val snapshot = api.recordingControl(store, device)
                val pending = async { runCatching { api.request("/articles/resolve", JSONObject().put("url", "https://en.wikipedia.org/wiki/Private"), device, snapshot) } }
                assertTrue(withContext(Dispatchers.IO) { entered.await(2, TimeUnit.SECONDS) })
                server.enqueue(control(2, true, markers())); Api(Settings(context)).recordingControl(store, device)
                release.countDown()
                assertTrue(pending.await().isFailure)
                val fresh = event(2); assertTrue(store.enqueue(device, fresh, null))
                assertTrue(runCatching { api.request("/reading-events/batch", JSONObject().put("events", JSONArray().put(event(1))), device, snapshot) }.isFailure)
                assertEquals(2, server.requestCount)
                assertEquals(fresh.getString("event_id"), store.rows(device).single().id)
            } finally { release.countDown(); http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll() }
        }
    }
}
