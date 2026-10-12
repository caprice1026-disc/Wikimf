package org.wikimf.reader

import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

/** Opt-in actual built Dashboard in Android WebView; API identity is an explicit fixture. */
class OAuthRecoveryViewRegressionTest {
    @Test fun anExistingSessionSeesTheFailureAndSafeRetryInsteadOfAutomaticNavigation() = runBlocking {
        val args=InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("oauth_recovery_view")=="true")
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        lateinit var view:WebView
        instrumentation.runOnMainSync {
            view=WebView(activity);view.settings.javaScriptEnabled=true;activity.setContentView(view)
            view.webViewClient=object:WebViewClient() {
                override fun shouldInterceptRequest(v:WebView,r:WebResourceRequest):WebResourceResponse? {
                    if(!r.url.path.orEmpty().startsWith("/api/v1/")) return null
                    val body=when(r.url.path) {
                        "/api/v1/me" -> "{\"user_id\":\"fixture\",\"display_name\":\"Fixture\",\"csrf_token\":\"synthetic\",\"timezone\":\"Asia/Tokyo\",\"collection_enabled\":false,\"recording_epoch\":1}"
                        "/api/v1/me/privacy" -> "{\"collection_enabled\":false,\"profile_public\":false,\"publish_total_time\":false,\"publish_achievements\":false,\"timezone\":\"Asia/Tokyo\",\"display_name\":\"Fixture\"}"
                        else -> "{}"
                    }
                    return WebResourceResponse("application/json","UTF-8",body.byteInputStream())
                }
            }
            view.loadUrl("http://10.0.2.2:4173/login?error=oauth_cancelled&returnTo=%2Fapp%2Flibrary%3Fwiki%3Djawiki")
        }
        try {
            var result=""
            repeat(100) {
                if(result.isBlank() || !org.json.JSONObject(result).optBoolean("ready") || !org.json.JSONObject(result).optBoolean("existing")) {
                    val value=AtomicReference<String?>()
                    instrumentation.runOnMainSync {
                        view.evaluateJavascript("JSON.stringify({ready:!!document.querySelector('[role=alert]')&&document.querySelector('[role=alert]').textContent.includes('キャンセル'),path:location.pathname,existing:[...document.querySelectorAll('a')].some(a=>a.textContent==='現在のログインで続ける'),retry:[...document.querySelectorAll('a')].find(a=>a.textContent.includes('Google で続ける'))?.href})") { value.set(it) }
                    }
                    delay(100)
                    val raw=value.get()
                    if(raw!=null) result=(JSONTokener(raw).nextValue() as? String).orEmpty()
                }
            }
            val json=org.json.JSONObject(result)
            assertTrue(json.getBoolean("ready"));assertEquals("/login",json.getString("path"));assertTrue(json.getBoolean("existing"))
            assertTrue(json.getString("retry").contains("return_to=%2Fapp%2Flibrary%3Fwiki%3Djawiki"))
        } finally { instrumentation.runOnMainSync { view.destroy();activity.finish() } }
    }
}
