package org.wikimf.reader

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.SocketException
import java.util.Collections
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class PrivacyRegressionTest {
    // Keep the linked Reader account and its queue in the separate credential-protected realm.
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext.createDeviceProtectedStorageContext()
    private val device = LinkedDevice("privacy-fixture", "privacy-phone", "synthetic-no-authority-token", "Fixture")
    private val articleId = "00000000-0000-4000-8000-000000000101"
    private fun event(epoch: Int = 2, article: String? = null) = JSONObject().put("event_id", UUID.randomUUID().toString()).put("recording_epoch", epoch)
        .put("article_id", article ?: JSONObject.NULL).put("session_started_at", "2026-01-01T00:00:00Z").put("private_reading_payload", "private-reading-marker")
    private fun scalar(db: SQLiteDatabase, sql: String): Long = db.rawQuery(sql, null).use { it.moveToFirst(); it.getLong(0) }

    @Test fun v1UpgradeErasesQuarantinedPayloadPreservesHistoryAndActiveQueue() {
        context.deleteDatabase("wikimf.sqlite")
        val path = context.getDatabasePath("wikimf.sqlite").apply { parentFile!!.mkdirs() }
        val active = event()
        SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
            db.execSQL("CREATE TABLE history(owner TEXT NOT NULL,kind TEXT NOT NULL,identity TEXT NOT NULL,wiki TEXT NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,page_id INTEGER,touched INTEGER NOT NULL,PRIMARY KEY(owner,kind,identity))")
            db.execSQL("INSERT INTO history VALUES('privacy-fixture','viewed','enwiki:101','enwiki','Preserved','https://en.wikipedia.org/wiki/Preserved',101,1)")
            db.execSQL("CREATE TABLE outbox(id TEXT PRIMARY KEY,owner TEXT NOT NULL,device TEXT NOT NULL,payload TEXT NOT NULL,pending_url TEXT,created INTEGER NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0,error TEXT,quarantined INTEGER NOT NULL DEFAULT 0)")
            db.execSQL("CREATE INDEX outbox_owner ON outbox(owner,device,next_try)")
            db.insertOrThrow("outbox", null, ContentValues().apply {
                put("id", active.getString("event_id")); put("owner", device.userId); put("device", device.deviceId); put("payload", active.toString())
                put("pending_url", "https://en.wikipedia.org/wiki/Preserved"); put("created", 1); put("attempt", 3)
            })
            db.beginTransaction()
            try {
                repeat(220) { index -> db.insertOrThrow("outbox", null, ContentValues().apply {
                    put("id", "legacy-$index"); put("owner", device.userId); put("device", device.deviceId)
                    put("payload", "erased-quarantine-secret-" + "x".repeat(50_000)); put("pending_url", "https://en.wikipedia.org/wiki/Erased")
                    put("created", index); put("error", "article_deleted"); put("quarantined", 1)
                }) }
                db.setTransactionSuccessful()
            } finally { db.endTransaction() }
            db.version = 1
        }
        LocalStore(context).use { store ->
            assertEquals(2, store.readableDatabase.version)
            assertEquals(1, store.count(device.userId)); assertEquals(100, store.quarantined(device.userId))
            assertEquals(active.toString(), store.rows(device).single().payload)
            assertEquals(3, store.rows(device).single().attempt)
            assertEquals("https://en.wikipedia.org/wiki/Preserved", store.rows(device).single().pendingUrl)
            assertEquals("Preserved", store.history(device.userId, "viewed", "enwiki").single().title)
            assertEquals(active.toString().toByteArray().size.toLong(), store.queueBytes())
            assertTrue(store.enqueue(device, event(), null))
            store.readableDatabase.rawQuery("PRAGMA table_info(diagnostics)", null).use { cursor ->
                val columns = buildSet { while (cursor.moveToNext()) add(cursor.getString(1)) }
                assertEquals(setOf("id", "owner", "code", "at"), columns)
            }
        }
        assertFalse("SQLite freed pages must not retain the quarantined reading payload", path.readBytes().toString(Charsets.UTF_8).contains("erased-quarantine-secret-"))
    }

    @Test fun terminalCleanupDropsPayloadAndKeepsOnlyBoundedSafeDiagnostics() {
        context.deleteDatabase("wikimf.sqlite")
        LocalStore(context).use { store ->
            val expired = event(); assertTrue(store.enqueue(device, expired, "https://en.wikipedia.org/wiki/Expired"))
            store.writableDatabase.execSQL("UPDATE outbox SET created=0 WHERE id=?", arrayOf(expired.getString("event_id")))
            store.expire(); assertEquals(0L, store.queueBytes())
            assertTrue(store.enqueue(device, event(1), null)); store.discardEpoch(device.userId, 2); assertEquals(0L, store.queueBytes())
            val deleted = event(article = articleId); assertTrue(store.enqueue(device, deleted, null))
            // Cleanup applies even to a row whose scheduled retry is still in the future.
            store.writableDatabase.execSQL("UPDATE outbox SET next_try=?", arrayOf(System.currentTimeMillis() + 86_400_000))
            store.discardDeleted(device.userId, JSONArray().put(JSONObject().put("article_id", articleId).put("deleted_before", "2026-02-01T00:00:00Z")))
            assertEquals(0L, store.queueBytes())
            repeat(150) { index ->
                val rejected = event().put("private_reading_payload", "x".repeat(50_000))
                assertTrue(store.enqueue(device, rejected, "https://en.wikipedia.org/wiki/Rejected"))
                store.quarantine(rejected.getString("event_id"), if (index == 149) "https://must-not-store.example/private" else "rejected")
            }
            assertEquals(0L, store.queueBytes()); assertEquals(0, store.count(device.userId)); assertEquals(100, store.quarantined(device.userId))
            assertEquals(0L, scalar(store.readableDatabase, "SELECT COUNT(*) FROM diagnostics WHERE code!='rejected'"))
            assertTrue(store.enqueue(device, event(), null))
            assertEquals(1, store.count(device.userId))
        }
    }

    @Test fun consentAndCollectionOffSendOnlyControlAndReconsentReplaysRetainedQueue() = runBlocking {
        val settings = Settings(context)
        val originalApi = settings.apiUrl
        try {
            for (mode in listOf("consent_off", "collection_off", "revoked_during_control")) {
                context.deleteDatabase("wikimf.sqlite")
                RecordingServer(device, articleId).use { server ->
                    settings.apiUrl = "http://127.0.0.1:${server.port}/api/v1"
                    settings.saveDevice(device); settings.cloudConsent = mode != "consent_off"; settings.serverEnabled = true
                    server.collection = mode != "collection_off"
                    if (mode == "revoked_during_control") server.beforeControlResponse = { settings.cloudConsent = false }
                    val pending = event().put("session_started_at", "2026-03-01T00:00:00Z")
                    LocalStore(context).use { store ->
                        assertTrue(store.enqueue(device, pending, "https://en.wikipedia.org/wiki/PrivatePending"))
                        assertTrue(store.enqueue(device, event(1), null))
                        assertTrue(store.enqueue(device, event(article = articleId), null))
                    }
                    assertTrue(SyncEngine(context).sync())
                    assertEquals(listOf("/api/v1/me/recording-control"), server.requests.map { it.first })
                    assertTrue(server.requests.single().second.isEmpty())
                    LocalStore(context).use { store ->
                        assertEquals(1, store.count(device.userId)); assertEquals(2, store.quarantined(device.userId))
                        assertEquals("https://en.wikipedia.org/wiki/PrivatePending", store.rows(device).single().pendingUrl)
                    }
                    for (path in listOf("/articles/resolve", "/reading-events/batch")) {
                        try { Api(settings).request(path, JSONObject().put("url", "https://en.wikipedia.org/wiki/PrivatePending"), device); fail("Reading content must not be sent while disabled") }
                        catch (failure: ApiFailure) { assertEquals("recording_disabled", failure.errorCode) }
                    }
                    assertEquals(1, server.requests.size)
                    settings.cloudConsent = true; server.collection = true; server.beforeControlResponse = null
                    assertTrue(SyncEngine(context).sync())
                    assertEquals(listOf("/api/v1/me/recording-control", "/api/v1/me/recording-control", "/api/v1/articles/resolve", "/api/v1/reading-events/batch"), server.requests.map { it.first })
                    LocalStore(context).use { assertEquals(0, it.count(device.userId)) }
                    server.failure.get()?.let { throw AssertionError("Fixture HTTP server failed", it) }
                    println("$mode: control only while OFF; resolve + batch after reconsent")
                }
            }
        } finally { settings.unlink(); settings.apiUrl = originalApi }
    }
    @Test fun readerResolveRefreshesControlAndFailsClosedOnControlError() = runBlocking {
        val settings = Settings(context)
        val originalApi = settings.apiUrl
        try {
            for (mode in listOf("collection_off", "control_unavailable")) {
                context.deleteDatabase("wikimf.sqlite")
                RecordingServer(device, articleId).use { server ->
                    settings.apiUrl = "http://127.0.0.1:${server.port}/api/v1"
                    settings.saveDevice(device); settings.cloudConsent = true; settings.serverEnabled = true
                    server.collection = false
                    server.controlStatus = if (mode == "control_unavailable") 503 else 200
                    LocalStore(context).use { store ->
                        try { Api(settings).resolveArticle(store, "https://en.wikipedia.org/wiki/PrivatePending", device); fail("Reader must not resolve using cached collection permission") }
                        catch (failure: ApiFailure) { assertEquals(if (mode == "control_unavailable") "control_unavailable" else "recording_disabled", failure.errorCode) }
                    }
                    assertEquals(listOf("/api/v1/me/recording-control"), server.requests.map { it.first })
                    assertTrue(server.requests.single().second.isEmpty())
                    server.failure.get()?.let { throw AssertionError("Fixture HTTP server failed", it) }
                    println("Reader $mode: fresh control only; no article URL")
                }
            }
        } finally { settings.unlink(); settings.apiUrl = originalApi }
    }
}

/** A real loopback HTTP server on the emulator, with no extra test dependency. */
private class RecordingServer(private val device: LinkedDevice, private val articleId: String) : AutoCloseable {
    private val server = ServerSocket().apply { bind(InetSocketAddress("127.0.0.1", 0)) }
    val port get() = server.localPort
    val requests = Collections.synchronizedList(mutableListOf<Pair<String, String>>())
    val failure = AtomicReference<Throwable?>()
    @Volatile var collection = true
    @Volatile var controlStatus = 200
    @Volatile var beforeControlResponse: (() -> Unit)? = null
    private val thread = Thread {
        try {
            while (!server.isClosed) server.accept().use { socket ->
                socket.soTimeout = 3000
                val input = socket.getInputStream().buffered()
                fun line(): String {
                    val bytes = java.io.ByteArrayOutputStream()
                    while (true) { val b = input.read(); if (b < 0 || b == 10) break; if (b != 13) bytes.write(b) }
                    return bytes.toString("UTF-8")
                }
                val path = line().split(' ')[1]
                var length = 0
                while (true) { val header = line(); if (header.isEmpty()) break; if (header.startsWith("Content-Length:", true)) length = header.substringAfter(':').trim().toInt() }
                val bodyBytes = ByteArray(length)
                var offset = 0
                while (offset < length) { val count = input.read(bodyBytes, offset, length - offset); require(count > 0); offset += count }
                val body = bodyBytes.toString(Charsets.UTF_8)
                requests.add(path to body)
                val status = if (path == "/api/v1/me/recording-control") controlStatus else 200
                val response = (if (status != 200) JSONObject().put("error", JSONObject().put("code", "control_unavailable")) else when (path) {
                    "/api/v1/me/recording-control" -> {
                        beforeControlResponse?.invoke()
                        JSONObject().put("user_id", device.userId).put("device_id", device.deviceId).put("recording_epoch", 2).put("collection_enabled", collection)
                            .put("deletion_markers", JSONArray().put(JSONObject().put("article_id", articleId).put("deleted_before", "2026-02-01T00:00:00Z")))
                    }
                    "/api/v1/articles/resolve" -> JSONObject().put("article_id", articleId).put("wiki", "enwiki").put("page_id", 101).put("trackable", true)
                    "/api/v1/reading-events/batch" -> JSONObject().put("results", JSONArray().put(JSONObject().put("event_id", JSONObject(body).getJSONArray("events").getJSONObject(0).getString("event_id")).put("status", "accepted")))
                    else -> error("Unexpected fixture HTTP path $path")
                }).toString().toByteArray()
                socket.getOutputStream().apply {
                    write("HTTP/1.1 $status Fixture\r\nContent-Type: application/json\r\nContent-Length: ${response.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    write(response); flush()
                }
            }
        } catch (closed: SocketException) { if (!server.isClosed) failure.set(closed) }
        catch (error: Throwable) { failure.set(error) }
    }.apply { isDaemon = true; start() }
    override fun close() { server.close(); thread.join(3000) }
}
