package org.wikimf.reader

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class SyncRetryRegressionTest {
    @Test fun metadata503AndBatch429KeepPayloadThenDuplicateAckClearsOnlyAcknowledgedRow() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext.createDeviceProtectedStorageContext()
        val settings = Settings(context)
        val oldApi = settings.apiUrl
        val device = LinkedDevice(UUID.randomUUID().toString(), UUID.randomUUID().toString(), "fixture-token", "Fixture")
        MockWebServer().use { server ->
            server.start(); settings.apiUrl = server.url("/api/v1").toString()
            settings.saveDevice(device); settings.cloudConsent = true; settings.serverEnabled = true
            LocalStore(context).use { store ->
                val id = UUID.randomUUID().toString()
                val event = JSONObject().put("event_id", id).put("recording_epoch", 1)
                    .put("session_started_at", "2026-10-12T00:00:00Z")
                fun control() = MockResponse().setBody(JSONObject().put("user_id",device.userId)
                    .put("device_id",device.deviceId).put("recording_epoch",1)
                    .put("collection_enabled",true).put("deletion_markers",org.json.JSONArray()).toString())
                fun due() { store.writableDatabase.execSQL("UPDATE outbox SET next_try=0 WHERE owner=?", arrayOf(device.userId)) }
                try {
                    assertTrue(store.enqueue(device,event,"https://ja.wikipedia.org/wiki/Fixture"))
                    val original = store.rows(device).single().payload
                    server.enqueue(control())
                    server.enqueue(MockResponse().setResponseCode(503).setBody("{\"error\":{\"code\":\"wikipedia_unavailable\"}}"))
                    assertFalse(SyncEngine(context).sync())
                    assertEquals(1,store.count(device.userId)); assertEquals(0,store.quarantined(device.userId))
                    assertTrue(settings.status.contains("HTTP503")); due()
                    assertEquals(original,store.rows(device).single().payload)
                    server.enqueue(control())
                    server.enqueue(MockResponse().setBody("{\"article_id\":\"00000000-0000-4000-8000-000000000101\",\"wiki\":\"jawiki\",\"page_id\":101,\"trackable\":true}"))
                    server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After","120")
                        .setBody("{\"error\":{\"code\":\"rate_limited\"}}"))
                    assertFalse(SyncEngine(context).sync())
                    assertEquals(1,store.count(device.userId)); assertEquals(0,store.quarantined(device.userId))
                    assertTrue(settings.status.contains("HTTP429"))
                    store.readableDatabase.rawQuery("SELECT next_try FROM outbox WHERE id=?",arrayOf(id)).use {
                        assertTrue(it.moveToFirst()); assertTrue(it.getLong(0)>=System.currentTimeMillis()+110_000)
                    }
                    due(); val finalized = store.rows(device).single().payload
                    assertEquals(id,JSONObject(finalized).getString("event_id"))
                    server.enqueue(control())
                    server.enqueue(MockResponse().setBody("{\"results\":[{\"event_id\":\"$id\",\"status\":\"duplicate\"}]}"))
                    assertTrue(SyncEngine(context).sync()); assertEquals(0,store.count(device.userId))
                    assertEquals(0,store.quarantined(device.userId))
                    val paths = (1..7).map { server.takeRequest().path }
                    assertEquals(2,paths.count { it=="/api/v1/articles/resolve" })
                    assertEquals(2,paths.count { it=="/api/v1/reading-events/batch" })
                } finally { store.discard(device.userId); settings.unlink(); settings.apiUrl=oldApi }
            }
        }
    }
}
