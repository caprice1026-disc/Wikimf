package org.wikimf.reader

import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/** Real WebView/bridge in an isolated DP fixture; no real API or user observation. */
class ReaderHomeRegressionTest {
    @Test fun homeFlushesCurrentSamplesKeepsBackHistoryAndRespectsPause() = runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext.createDeviceProtectedStorageContext()
        val settings=Settings(context);val previousApi=settings.apiUrl
        val device=LinkedDevice(UUID.randomUUID().toString(),UUID.randomUUID().toString(),"synthetic-no-authority-token","Fixture")
        val articleId=UUID.randomUUID().toString()
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val store=LocalStore(context);var controller:ReaderController?=null
        MockWebServer().use { server ->
            server.dispatcher=object:Dispatcher() {
                override fun dispatch(r:RecordedRequest):MockResponse {
                    val body=when {
                        r.path!!.endsWith("/recording-control") -> JSONObject().put("user_id",device.userId).put("device_id",device.deviceId).put("recording_epoch",1).put("collection_enabled",true).put("deletion_markers",JSONArray())
                        r.path!!.endsWith("/articles/resolve") -> JSONObject().put("article_id",articleId).put("wiki","enwiki").put("page_id",9228).put("namespace",0).put("trackable",true)
                        else -> JSONObject().put("effective_state","viewed").put("evidence","inferred")
                    }
                    return MockResponse().setHeader("Content-Type","application/json").setBody(body.toString())
                }
            }
            server.start();settings.apiUrl=server.url("/api/v1").toString();settings.saveDevice(device)
            settings.cloudConsent=true;settings.serverEnabled=true;settings.paused=false
            val initial="https://en.wikipedia.org/wiki/Earth"
            try {
                instrumentation.runOnMainSync {
                    controller=ReaderController(activity,settings,store,scope,{true},{},{},{})
                    controller!!.url=initial
                    val view=controller!!.create(null);val original=view.webViewClient
                    val html="<html><head><script>window.mw={config:{get:k=>({wgArticleId:9228,wgNamespaceNumber:0,wgTitle:'Earth'})[k]}}</script></head><body><div id='mw-content-text'><div class='mw-parser-output'><p>${"a".repeat(1200)}</p></div></div></body></html>"
                    view.webViewClient=object:WebViewClient() {
                        override fun shouldInterceptRequest(v:WebView,r:WebResourceRequest):WebResourceResponse?=WebResourceResponse("text/html","UTF-8",html.byteInputStream())
                        override fun onPageStarted(v:WebView,url:String?,favicon:android.graphics.Bitmap?)=original.onPageStarted(v,url,favicon)
                        override fun onPageFinished(v:WebView,url:String?)=original.onPageFinished(v,url)
                    }
                    view.stopLoading();view.loadUrl(initial);activity.setContentView(view);view.requestFocus()
                }
                fun await(condition:()->Boolean) { repeat(100) { if(condition())return;Thread.sleep(100) };error("Reader condition timed out") }
                fun rows()=store.rows(device).map { JSONObject(it.payload) }
                await { rows().any { it.optString("type")=="session.opened" } }
                val session=rows().first { it.getString("type")=="session.opened" }.getString("session_id")
                delay(2400)
                instrumentation.runOnMainSync { controller!!.goHome() }
                await { controller!!.url=="https://en.wikipedia.org/wiki/Main_Page" }
                await { rows().any { it.optString("session_id")==session && it.getJSONObject("progress").getLong("active_ms_total")>=1000 } }
                assertTrue("Home is normal navigation with retained back history",controller!!.canBack)
                assertTrue(settings.cloudConsent);assertFalse(settings.paused)
                instrumentation.runOnMainSync { controller!!.webView!!.goBack() }
                await { controller!!.url==initial }
                instrumentation.runOnMainSync { settings.paused=true;controller!!.activeChanged() }
                delay(300) // Drain the pause-boundary observation before comparing inactive time.
                val before=rows().sumOf { it.getJSONObject("interval").getJSONArray("active_spans_ms").let { spans -> (0 until spans.length()).sumOf { i -> spans.getJSONArray(i).getLong(1)-spans.getJSONArray(i).getLong(0) } } }
                delay(700);instrumentation.runOnMainSync { controller!!.activeChanged();controller!!.goHome() }
                await { controller!!.url.endsWith("/wiki/Main_Page") }
                assertTrue("Home must preserve explicit pause",settings.paused)
                assertTrue("Home must preserve cloud opt-in",settings.cloudConsent)
                val after=rows().sumOf { it.getJSONObject("interval").getJSONArray("active_spans_ms").let { spans -> (0 until spans.length()).sumOf { i -> spans.getJSONArray(i).getLong(1)-spans.getJSONArray(i).getLong(0) } } }
                assertEquals("Paused time cannot be added",before,after)
            } finally {
                instrumentation.runOnMainSync { controller?.destroy();activity.finish() }
                scope.cancel();store.discard(device.userId);store.close();settings.unlink();settings.apiUrl=previousApi
            }
        }
    }
}
