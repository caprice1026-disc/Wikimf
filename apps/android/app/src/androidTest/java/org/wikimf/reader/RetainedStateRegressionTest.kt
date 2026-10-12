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
        assumeTrue(stage in setOf("seed","verify"))
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val settings=Settings(context)
        val device=settings.device() ?: error("Link the dedicated emulator before this check")
        assertEquals(device.userId,Api(settings).request("/me").getString("user_id"))
        LocalStore(context).use { store ->
            if(stage=="seed") {
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
                // Remove only this test's acknowledged zero-time fixture after preserving it through the update.
                store.ack(row.id)
            }
        }
    }
    private fun digest(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
