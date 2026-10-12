package org.wikimf.reader

import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/** Real emulator WebView, shared production asset, synthetic prose and identities. */
class ReadingMeasurementRegressionTest {
    @Test fun visibleDwellIsCumulativeAtOnePointEightSecondsAndInactiveTimeIsExcluded() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val events = CopyOnWriteArrayList<JSONObject>()
        val observer = object { @JavascriptInterface fun observed(raw: String) { events.add(JSONObject(raw)) } }
        lateinit var view: WebView
        val context = JSONObject().put("article",JSONObject().put("article_id",UUID.randomUUID().toString()).put("wiki","enwiki").put("page_id",101))
            .put("deviceId",UUID.randomUUID().toString()).put("sessionId",UUID.randomUUID().toString()).put("epoch",1).put("active",true)
        val asset = instrumentation.targetContext.assets.open("android-tracker.js").bufferedReader().use { it.readText() }
        instrumentation.runOnMainSync {
            view=WebView(activity);view.settings.javaScriptEnabled=true;view.addJavascriptInterface(observer,"Fixture")
            activity.setContentView(view);view.requestFocus()
            view.loadDataWithBaseURL("https://en.wikipedia.org/wiki/Fixture",
                "<html><body><div id='mw-content-text'><div class='mw-parser-output'><p style='word-break:break-all'>${"a".repeat(200)}</p></div></div><script>window.WKMF_CONTEXT=$context;window.WikimfObservation={postMessage:raw=>Fixture.observed(raw)};</script><script>$asset</script></body></html>","text/html","UTF-8",null)
        }
        fun js(expression: String) { instrumentation.runOnMainSync { view.evaluateJavascript(expression,null) } }
        suspend fun waitFor(predicate: () -> Boolean) { repeat(100) { if(predicate()) return;delay(100) };error("WebView observation timeout") }
        try {
            waitFor { events.any { it.optString("type")=="session.opened" } }
            delay(1200);js("window.WKMF_NATIVE.setActive(false)")
            waitFor { events.any { it.optString("type")=="reading.observed" } }
            val prefix=events.last { it.optString("type")=="reading.observed" }
            assertEquals(0,prefix.getJSONObject("progress").getJSONArray("covered_chunk_ids").length())
            val before=prefix.getJSONObject("progress").getLong("active_ms_total")
            delay(1000);js("window.WKMF_NATIVE.setActive(true)")
            delay(1000);js("window.WKMF_NATIVE.stop('pause')")
            waitFor { events.any { it.optString("type")=="session.closed" } }
            val closed=events.last { it.optString("type")=="session.closed" }
            assertEquals("reading-v2",closed.getString("measurement_policy_version"))
            assertEquals(1,closed.getJSONObject("progress").getJSONArray("covered_chunk_ids").length())
            assertTrue(closed.getJSONObject("progress").getLong("active_ms_total") in (before+800)..(before+1400))
            assertEquals(200,closed.getJSONObject("document").getInt("text_chars"))
        } finally { instrumentation.runOnMainSync { view.destroy();activity.finish() } }
    }
}
