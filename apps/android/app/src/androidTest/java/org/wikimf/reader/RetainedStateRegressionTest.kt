package org.wikimf.reader

import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

/** Opt-in before/after APK update check on the dedicated emulator; never a data migration. */
class RetainedStateRegressionTest {
    @Test fun encryptedCredentialsHistoryAndOutboxSurviveInPlaceUpdate() = runBlocking {
        val args=InstrumentationRegistry.getArguments()
        val stage=args.getString("retention_stage")
        assumeTrue(stage in setOf("seed","verify","sync","cleanup_fixture","snapshot"))
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val settings=Settings(context)
        if(stage=="snapshot") {
            assertTrue("Snapshot only the dedicated QA app",context.packageName=="org.wikimf.reader.lan.local")
            assertTrue("Snapshot only the isolated QA API",settings.apiUrl=="http://10.0.2.2:18080/api/v1")
            assertFalse("Keep cloud consent OFF across the APK update",settings.cloudConsent)
            fun preferences(name:String)=digest(JSONObject(context.getSharedPreferences(name,android.content.Context.MODE_PRIVATE).all.toSortedMap()).toString())
            val snapshot=JSONObject().put("preferences_sha256",preferences("preferences"))
                .put("encrypted_credentials_sha256",preferences("encrypted_credentials"))
                .put("cloud_consent",settings.cloudConsent).put("local_consent",settings.localConsent)
            LocalStore(context).use { store ->
                for(table in listOf("history","outbox","diagnostics")) {
                    val content=JSONArray()
                    store.readableDatabase.rawQuery("SELECT * FROM $table ORDER BY "+if(table=="history")"owner,kind,identity" else "id",null).use { cursor ->
                        content.put(JSONArray(cursor.columnNames.toList()))
                        while(cursor.moveToNext())content.put(JSONArray((0 until cursor.columnCount).map { if(cursor.isNull(it))JSONObject.NULL else cursor.getString(it) }))
                        snapshot.put(table+"_rows",cursor.count)
                    }
                    snapshot.put(table+"_sha256",digest(content.toString()))
                }
            }
            InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply { putString("retention_snapshot",snapshot.toString()) })
            return@runBlocking
        }
        val device=settings.device() ?: error("Link the dedicated emulator before this check")
        assertEquals(device.userId,Api(settings).request("/me").getString("user_id"))
        LocalStore(context).use { store ->
            if(stage=="cleanup_fixture") {
                assertEquals("http://10.0.2.2:18080/api/v1",settings.apiUrl)
                val id=UUID.fromString(args.getString("expected_event_id")).toString()
                // Remove only the explicitly identified synthetic check; preserve all other rows.
                store.writableDatabase.delete("diagnostics","id=? AND owner=?",arrayOf(id,device.userId))
                store.writableDatabase.delete("outbox","id=? AND owner=?",arrayOf(id,device.userId))
                SyncUiUpdates.changed()
            } else if(stage=="seed") {
                assertFalse(settings.cloudConsent)
                val id=UUID.randomUUID().toString();val stamp=Instant.now().toString()
                val event=JSONObject().put("schema_version",1).put("event_id",id).put("type","session.opened")
                    .put("device_id",device.deviceId).put("session_id",UUID.randomUUID().toString()).put("session_started_at",stamp)
                    .put("seq",0).put("source","android_reader").put("article_id",args.getString("qa_article_id"))
                    .put("wiki","enwiki").put("page_id",args.getString("qa_page_id")!!.toLong()).put("recording_epoch",settings.epoch)
                    .put("occurred_at",stamp).put("interval",JSONObject().put("start_at",stamp).put("end_at",stamp).put("active_spans_ms",JSONArray()))
                    .put("document",JSONObject().put("fingerprint",JSONObject.NULL).put("extractor_version","prose-v1")
                        .put("observed_revision_id",JSONObject.NULL).put("text_chars",JSONObject.NULL).put("chunk_chars",JSONArray()))
                    .put("progress",JSONObject().put("active_ms_total",0).put("covered_chunk_ids",JSONArray()).put("measurement_status","time_only")
                        .put("max_scroll_ratio",0.0).put("reason_code","body_not_found"))
                    .put("client_version",BuildConfig.VERSION_NAME).put("measurement_policy_version","reading-v2")
                assertTrue(store.enqueue(device,event,null));settings.localConsent=true
                store.remember(device.userId,"recent",HistoryEntry(wiki="enwiki",key="qa-update-retention",title="APK update retention fixture",pageId=null,url="https://en.wikipedia.org/wiki/Imoni"))
                // Instrumentation exits its VM immediately; drain apply before measuring update retention.
                assertTrue(context.getSharedPreferences("preferences",android.content.Context.MODE_PRIVATE).edit().commit())
                val row=store.rows(device).single { it.id==id }
                val result=JSONObject().put("device_id",device.deviceId).put("event_id",id).put("payload_sha256",digest(row.payload))
                InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply { putString("retention_result",result.toString()) })
            } else {
                assertEquals(args.getString("expected_device_id"),device.deviceId)
                val row=store.rows(device).single { it.id==args.getString("expected_event_id") }
                assertEquals(args.getString("expected_payload_sha256"),digest(row.payload))
                assertTrue("Local opt-in persists",settings.localConsent);assertFalse("Cloud opt-in stays OFF",settings.cloudConsent)
                assertTrue(store.history(device.userId,"recent","enwiki").any { it.title=="APK update retention fixture" })
                if(stage=="sync") {
                    assertEquals("Do not synchronize unrelated retained data",listOf(row.id),store.rows(device).map { it.id })
                    // A real LAN API ACK, then an identical replay, establishes delivery and deduplication.
                    // Restrict this opt-in test to the dedicated emulator's loopback QA stack.
                    assertEquals("http://10.0.2.2:18080/api/v1",settings.apiUrl)
                    val event=JSONObject(row.payload)
                    try {
                        settings.cloudConsent=true
                        assertTrue(SyncEngine(context).sync())
                        assertFalse(store.rows(device).any { it.id==row.id })
                        val api=Api(settings);val control=api.recordingControl(store,device)
                        assertTrue(settings.serverEnabled)
                        val replay=api.request("/reading-events/batch",JSONObject().put("schema_version",1).put("events",JSONArray().put(event)),device,control)
                        assertEquals("duplicate",replay.getJSONArray("results").getJSONObject(0).getString("status"))
                        assertFalse(store.rows(device).any { it.id==row.id })
                    } finally {
                        settings.cloudConsent=false
                        assertTrue(context.getSharedPreferences("preferences",android.content.Context.MODE_PRIVATE).edit().commit())
                    }
                }
            }
        }
    }
    private fun digest(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
