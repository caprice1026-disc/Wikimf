package org.wikimf.reader

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
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
    @Test fun tokenIsEncryptedSeparatelyAndLinkingRequiresNewCloudConsent() {
        val settings = Settings(context)
        settings.unlink()
        settings.cloudConsent = true
        val device = LinkedDevice(UUID.randomUUID().toString(), UUID.randomUUID().toString(), "synthetic-no-authority-token", "Fixture")
        settings.saveDevice(device)
        assertEquals(device, settings.device())
        assertFalse(settings.cloudConsent)
        val stored = context.getSharedPreferences("encrypted_credentials", 0).getString("device", "")!!
        assertFalse(stored.contains(device.token))
        settings.unlink()
        assertNull(settings.device())
    }
}
