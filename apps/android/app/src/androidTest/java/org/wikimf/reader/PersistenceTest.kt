package org.wikimf.reader

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PersistenceTest {
    // Separate storage realm keeps the actual Reader's linked account and queue untouched.
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext.createDeviceProtectedStorageContext()
    @Test fun immutableQueueSurvivesReopenAndNeverUsesAnotherAccount() {
        context.deleteDatabase("wikimf.sqlite")
        val alice = LinkedDevice("alice", "phone-a", "synthetic-token-a", "Alice")
        val bob = LinkedDevice("bob", "phone-b", "synthetic-token-b", "Bob")
        val id = UUID.randomUUID().toString()
        val event = JSONObject().put("event_id", id).put("recording_epoch", 1).put("fixed", "original")
        LocalStore(context).use { store ->
            assertTrue(store.enqueue(alice, event, "https://en.wikipedia.org/wiki/Example"))
            assertFalse(store.enqueue(alice, JSONObject(event.toString()).put("fixed", "changed"), null))
            store.remember("alice", "viewed", HistoryEntry("enwiki", "Example", "Example", 10, "https://en.wikipedia.org/wiki/Example"))
        }
        LocalStore(context).use { store ->
            assertEquals(1, store.count("alice"))
            assertEquals(0, store.rows(bob).size)
            assertEquals("original", JSONObject(store.rows(alice).single().payload).getString("fixed"))
            assertEquals(0, store.history("bob", "viewed", "enwiki").size)
            assertEquals(1, store.history("alice", "viewed", "enwiki").size)
            val ready = JSONObject(store.rows(alice).single().payload).put("article_id", "fixed-resolved-id")
            store.finalizePending(id, ready)
            store.finalizePending(id, JSONObject(ready.toString()).put("article_id", "tampered"))
            assertEquals("fixed-resolved-id", JSONObject(store.rows(alice).single().payload).getString("article_id"))
            store.discardEpoch("alice", 2)
            assertEquals(0, store.count("alice"))
            assertEquals(1, store.quarantined("alice"))
            store.clearHistory("alice")
            assertTrue(store.history("alice", "viewed", "enwiki").isEmpty())
        }
    }
    @Test fun tokenIsEncryptedSeparatelyAndLinkingRequiresNewCloudConsent() = runBlocking {
        val settings = Settings(context)
        settings.unlink()
        val originalApi = settings.apiUrl
        settings.apiUrl = "https://old-api.example/api/v1"
        settings.cloudConsent = true
        val device = LinkedDevice(UUID.randomUUID().toString(), UUID.randomUUID().toString(), "synthetic-no-authority-token", "Fixture")
        settings.saveDevice(device)
        assertEquals(device, settings.device())
        assertFalse(settings.cloudConsent)
        val stored = context.getSharedPreferences("encrypted_credentials", 0).getString("device", "")!!
        assertFalse(stored.contains(device.token))
        settings.cloudConsent = true
        LocalStore(context).use { store ->
            val event = JSONObject().put("event_id", UUID.randomUUID().toString()).put("recording_epoch", 1)
            assertTrue(store.enqueue(device, event, null))
            settings.apiUrl = "https://old-api.example/api/v1"
            assertEquals(device, settings.device()); assertTrue(settings.cloudConsent)
            settings.apiUrl = "https://old-api.example/api/v1/"
            assertEquals(device, settings.device()); assertTrue(settings.cloudConsent)
            settings.apiUrl = "https://new-api.example/api/v1"
            assertNull(settings.device()); assertFalse(settings.cloudConsent)
            assertEquals(1, store.count(device.userId))
            assertEquals(device.deviceId, store.rows(device).single().device)
            try {
                Api(settings).request("/me", device = device)
                fail("A captured old credential must be refused before requesting a new API host")
            } catch (failure: ApiFailure) {
                assertEquals(401, failure.code)
                assertEquals("device_binding_changed", failure.errorCode)
            }
            store.discard(device.userId)
        }
        settings.apiUrl = originalApi
        assertNull(settings.device())
    }
}
