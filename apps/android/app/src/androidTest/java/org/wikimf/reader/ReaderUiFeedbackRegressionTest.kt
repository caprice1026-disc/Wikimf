package org.wikimf.reader

import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

/** Actual Compose dialog, using only isolated synthetic destinations. */
class ReaderUiFeedbackRegressionTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun matchingText(node: AccessibilityNodeInfo, text: String): List<AccessibilityNodeInfo> {
        val matches = mutableListOf<AccessibilityNodeInfo>()
        if (node.isVisibleToUser && node.text?.toString()?.contains(text) == true) matches += node
        for (i in 0 until node.childCount) node.getChild(i)?.let { matches += matchingText(it, text) }
        return matches
    }
    private fun awaitText(text: String): List<AccessibilityNodeInfo> {
        repeat(80) {
            // Compose exposes virtual children; its provider does not implement platform text search.
            val nodes=instrumentation.uiAutomation.rootInActiveWindow?.let { matchingText(it, text) }.orEmpty()
            if(nodes.isNotEmpty()) return nodes
            Thread.sleep(100)
        }
        error("UI text did not appear: $text")
    }
    private fun click(text: String) {
        val nodes=awaitText(text)
        var node=nodes.first()
        while (!node.isClickable) node=node.parent ?: error("No clickable ancestor: $text")
        assertTrue("Click target is enabled",node.isEnabled)
        assertTrue(node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        instrumentation.waitForIdleSync()
    }
    @Test fun externalDialogNamesDestinationExplainsReturnAndHasExplicitCancelAndOpen() {
        val activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val result=AtomicReference<String?>()
        val target="https://example.org/help?language=ja"
        fun render()=instrumentation.runOnMainSync { activity.setContent { MaterialTheme { ExternalLinkDialog(target,onOpen={result.set(it)},onCancel={result.set("cancelled")}) } } }
        try {
            render();awaitText("リンク先: example.org");awaitText(target);awaitText("Readerの対象外");awaitText("アプリ切り替え");awaitText("一時停止")
            click("キャンセル");assertEquals("cancelled",result.get())
            result.set(null);render();click("ブラウザで開く");assertEquals(target,result.get())
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun unsafeDestinationCannotBeOpenedByTheDialog() {
        val activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        val result=AtomicReference<String?>()
        try {
            for(target in listOf("javascript:alert(1)","https://user:secret@example.org/","file:///private")) {
                instrumentation.runOnMainSync { activity.setContent { MaterialTheme { ExternalLinkDialog(target,onOpen={result.set(it)},onCancel={}) } } }
                awaitText("このリンクは開けません")
                var open=awaitText("ブラウザで開く").first()
                while (!open.isClickable) open=open.parent ?: error("Confirm action missing")
                assertFalse("Unsafe confirm action remains disabled",open.isEnabled)
                assertNull(result.get())
            }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
    @Test fun mainMenuOffersWikipediaHomeWithoutChangingConsentAndBackStillWorks() {
        val settings=Settings(instrumentation.targetContext)
        val consent=settings.cloudConsent;val paused=settings.paused;val language=settings.language
        val activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        lateinit var view:WebView
        fun find(v:View):WebView? = if(v is WebView)v else if(v is ViewGroup)(0 until v.childCount).firstNotNullOfOrNull { find(v.getChildAt(it)) } else null
        fun currentUrl():String? { val result=AtomicReference<String?>();instrumentation.runOnMainSync { result.set(view.url) };return result.get() }
        fun await(condition:()->Boolean) { repeat(100) { if(condition())return;Thread.sleep(100) };error("Menu navigation timed out") }
        try {
            instrumentation.runOnMainSync {
                view=find(activity.window.decorView) ?: error("Main Reader WebView missing")
                val original=view.webViewClient
                val html="<html><body><div id='mw-content-text'><div class='mw-parser-output'><p>Menu navigation fixture</p></div></div></body></html>"
                view.webViewClient=object:WebViewClient() {
                    override fun shouldInterceptRequest(v:WebView,r:WebResourceRequest)=WebResourceResponse("text/html","UTF-8",html.byteInputStream())
                    override fun onPageStarted(v:WebView,url:String?,icon:android.graphics.Bitmap?)=original.onPageStarted(v,url,icon)
                    override fun onPageFinished(v:WebView,url:String?)=original.onPageFinished(v,url)
                }
                view.stopLoading();view.loadUrl("https://en.wikipedia.org/wiki/Earth")
            }
            await { currentUrl()=="https://en.wikipedia.org/wiki/Earth" }
            click("メニュー");click("Wikipediaホームへ")
            await { currentUrl()=="https://en.wikipedia.org/wiki/Main_Page" }
            val canBack=AtomicReference<Boolean>();instrumentation.runOnMainSync { canBack.set(view.canGoBack()) };assertTrue(canBack.get())
            click("← 戻る");await { currentUrl()=="https://en.wikipedia.org/wiki/Earth" }
            assertEquals(consent,settings.cloudConsent);assertEquals(paused,settings.paused);assertEquals(language,settings.language)
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
