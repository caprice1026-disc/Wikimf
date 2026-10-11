package org.wikimf.reader

import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class ReaderLifecycleRegressionTest {
    @Test fun hiddenDocumentChangesAndDeletionResumeUseFreshNativeSessions() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext.createDeviceProtectedStorageContext()
        val settings = Settings(context)
        val originalApi = settings.apiUrl
        val device = LinkedDevice(UUID.randomUUID().toString(), UUID.randomUUID().toString(), "synthetic-no-authority-token", "Fixture")
        val articleId = UUID.randomUUID().toString()
        val markers = AtomicReference(JSONArray())
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        var active = true
        var controller: ReaderController? = null
        var unsubscribe: (() -> Unit)? = null
        val store = LocalStore(context)
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val json = when {
                        request.path!!.endsWith("/recording-control") -> JSONObject().put("user_id", device.userId).put("device_id", device.deviceId).put("recording_epoch", 1).put("collection_enabled", true).put("deletion_markers", markers.get())
                        request.path!!.endsWith("/articles/resolve") -> JSONObject().put("article_id", articleId).put("wiki", "enwiki").put("page_id", 9228).put("namespace", 0).put("trackable", true)
                        else -> JSONObject().put("effective_state", "viewed").put("evidence", "inferred")
                    }
                    return MockResponse().setHeader("Content-Type", "application/json").setBody(json.toString())
                }
            }
            server.start()
            settings.apiUrl = server.url("/api/v1").toString(); settings.saveDevice(device)
            settings.cloudConsent = true; settings.localConsent = true; settings.paused = false; settings.serverEnabled = true
            try {
                instrumentation.runOnMainSync {
                    controller = ReaderController(activity, settings, store, scope, { active }, {}, {}, {})
                    controller!!.url = "https://en.wikipedia.org/w/index.php?title=Earth&action=view"
                    val view = controller!!.create(null)
                    val original = view.webViewClient
                    val html = "<html><head><script>window.mw={config:{get:k=>({wgArticleId:9228,wgNamespaceNumber:0,wgTitle:'Earth'})[k]}}</script></head><body><div id='mw-content-text'><div class='mw-parser-output'><p id='lead'>${"a".repeat(1200)}</p></div></div></body></html>"
                    view.webViewClient = object : WebViewClient() {
                        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                            if (request.url.host == "en.wikipedia.org") WebResourceResponse("text/html", "UTF-8", html.byteInputStream()) else null
                        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) = original.onPageStarted(view, url, favicon)
                        override fun onPageFinished(view: WebView, url: String?) = original.onPageFinished(view, url)
                    }
                    activity.setContentView(view); view.requestFocus()
                    unsubscribe = settings.observeControl { controller!!.activeChanged() }
                }
                fun javascript(source: String): String? {
                    val value = AtomicReference<String?>(); val done = CountDownLatch(1)
                    instrumentation.runOnMainSync { controller!!.webView!!.evaluateJavascript(source) { value.set(it); done.countDown() } }
                    assertTrue(done.await(5, TimeUnit.SECONDS)); return value.get()
                }
                fun session(): String? = javascript("window.WKMF_NATIVE?.sessionId")?.takeIf { it != "null" }?.let { JSONTokener(it).nextValue() as? String }
                fun awaitSession(previous: String? = null): String {
                    repeat(100) { val current = session(); if (current != null && current != previous) return current; Thread.sleep(100) }
                    error("Native session did not start/restart")
                }
                var current = awaitSession()
                assertTrue("index.php current article must be remembered", store.history(device.userId, "viewed", "enwiki").isNotEmpty())
                for (mode in listOf("account", "search", "pause", "background")) {
                    instrumentation.runOnMainSync { if (mode == "pause") settings.paused = true else active = false; controller!!.activeChanged() }
                    javascript("true"); Thread.sleep(200)
                    val totalBefore = store.rows(device).map { JSONObject(it.payload) }.filter { it.optString("session_id") == current }.maxOfOrNull { it.getJSONObject("progress").getLong("active_ms_total") } ?: 0
                    javascript("document.getElementById('lead').append('changed-$mode')")
                    Thread.sleep(2500)
                    val closed = store.rows(device).map { JSONObject(it.payload) }.filter { it.optString("session_id") == current && it.optString("type") == "session.closed" }
                    assertTrue("$mode must invalidate the stopped Native context", closed.isNotEmpty())
                    assertEquals("Hidden time must not be credited", totalBefore, closed.last().getJSONObject("progress").getLong("active_ms_total"))
                    instrumentation.runOnMainSync { active = true; settings.paused = false; controller!!.activeChanged() }
                    current = awaitSession(current)
                }
                instrumentation.runOnMainSync { active = false; controller!!.activeChanged() }
                Thread.sleep(500)
                instrumentation.runOnMainSync { active = true; controller!!.activeChanged() }
                assertEquals("Without a DOM update, keep the same session", current, session())
                val cutoff = System.currentTimeMillis() + 2000
                markers.set(JSONArray().put(JSONObject().put("article_id", articleId).put("deleted_before", java.time.Instant.ofEpochMilli(cutoff).toString())))
                withContext(Dispatchers.Main) { Api(settings).recordingControl(store, device) }
                assertFalse("Old sessions must be removed from Outbox", store.rows(device).any { JSONObject(it.payload).optString("session_id") == current })
                Thread.sleep(2500)
                val fresh = awaitSession(current)
                val opened = store.rows(device).map { JSONObject(it.payload) }.first { it.optString("session_id") == fresh }
                assertTrue(java.time.Instant.parse(opened.getString("session_started_at")).toEpochMilli() > cutoff)
                assertTrue("Only post-cutoff sessions may remain", store.rows(device).all { java.time.Instant.parse(JSONObject(it.payload).getString("session_started_at")).toEpochMilli() > cutoff })
            } finally {
                instrumentation.runOnMainSync { unsubscribe?.invoke(); controller?.destroy(); activity.finish() }
                scope.cancel(); store.discard(device.userId); store.close(); settings.unlink(); settings.apiUrl = originalApi
            }
        }
    }
}
