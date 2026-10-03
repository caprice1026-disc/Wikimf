package org.wikimf.reader

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Explicit integration test only: requires a genuinely linked synthetic test account. */
@RunWith(AndroidJUnit4::class)
class ReaderFocusRegressionTest {
    @Test fun readerOwnsInputFocusAndProducesAcceptedTime() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("native_smoke") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val settings = Settings(instrumentation.targetContext)
        assertNotNull("Pair the app with a synthetic account first", settings.device())
        assertTrue(settings.cloudConsent)
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        fun findWebView(view: View): WebView? = when (view) {
            is WebView -> view
            is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { findWebView(view.getChildAt(it)) }
            else -> null
        }
        var webView: WebView? = null
        repeat(50) { if (webView == null) { instrumentation.runOnMainSync { webView = findWebView(activity.window.decorView) }; Thread.sleep(100) } }
        val view = webView ?: error("Reader WebView was not mounted")
        val articleUrl = InstrumentationRegistry.getArguments().getString("article_url") ?: "https://en.wikipedia.org/wiki/Earth"
        assertEquals(UrlPolicy.Destination.READER, UrlPolicy.classify(articleUrl))
        instrumentation.runOnMainSync {
            // Reproduce the native search field owning focus before returning to Reader.
            view.clearFocus()
            activity.window.decorView.isFocusableInTouchMode = true
            activity.window.decorView.requestFocus()
            // Actual navigation preserves the same final URL/origin checks as production.
            view.loadUrl(articleUrl)
        }
        fun javascript(expression: String): String? {
            val value = AtomicReference<String?>()
            val done = CountDownLatch(1)
            instrumentation.runOnMainSync { view.evaluateJavascript(expression) { value.set(it); done.countDown() } }
            assertTrue(done.await(3, TimeUnit.SECONDS))
            return value.get()
        }
        var sessionId: String? = null
        repeat(150) {
            if (sessionId == null) {
                val raw = javascript("window.WKMF_NATIVE?.sessionId")
                sessionId = raw?.takeIf { it != "null" }?.let { JSONTokener(it).nextValue() as? String }
                Thread.sleep(200)
            }
        }
        assertNotNull("Native did not start the trusted article tracker", sessionId)
        assertEquals("Native must transfer input focus from Compose to WebView", "true", javascript("document.hasFocus()"))
        var acceptedActiveMs = 0L
        repeat(35) {
            if (acceptedActiveMs < 10_000) {
                Thread.sleep(1_000)
                val activities = Api(settings).request("/me/activities?limit=100").getJSONArray("items")
                for (i in 0 until activities.length()) {
                    val item = activities.getJSONObject(i)
                    if (item.getString("session_id") == sessionId) acceptedActiveMs = item.getLong("active_ms")
                }
            }
        }
        assertTrue("Accepted native time should cross the viewed threshold; got $acceptedActiveMs", acceptedActiveMs >= 10_000)
        instrumentation.runOnMainSync { activity.finish() }
    }
}
