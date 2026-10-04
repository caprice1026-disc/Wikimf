package org.wikimf.reader

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** Opt-in live Wikipedia UI test. Adds/reorders two QA articles; never clears existing history. */
@RunWith(AndroidJUnit4::class)
class NativeSearchUiRegressionTest {
    @Test fun japaneseAndEnglishSearchPreserveHistoryUntilSelectionAndHandleBack() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue("Live search requires native_search_smoke=true", arguments.getString("native_search_smoke") == "true")
        val expectedOwner = arguments.getString("native_search_owner")
        assumeTrue("Supply the isolated QA user as native_search_owner", !expectedOwner.isNullOrBlank())
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val settings = Settings(instrumentation.targetContext)
        assertEquals("Search must use the explicitly selected QA owner", expectedOwner, settings.device()?.userId)
        val owner = expectedOwner!!
        val store = LocalStore(instrumentation.targetContext)
        fun history(kind: String, wiki: String = "enwiki") = store.history(owner, kind, wiki)
        fun identity(hit: HistoryEntry) = hit.pageId?.let { "${hit.wiki}:$it" } ?: hit.url.substringBefore('#')
        fun keys(kind: String) = history(kind).map(::identity).toSet()
        val existingSearched = keys("searched")
        val existingViewed = keys("viewed")
        // Two additions must not trigger the product's twenty-entry retention eviction.
        if (existingSearched.size > 18 || existingViewed.size > 18) {
            store.close()
            assumeTrue("Use a QA owner with at least two free history slots; no history is erased", false)
        }
        val originalConsent = settings.localConsent
        val originalLanguage = settings.language
        var activity: MainActivity? = null
        try {
            // Test preparation only; this is not evidence of the Account consent-switch interaction.
            settings.localConsent = true
            val screen = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            activity = screen

            fun await(message: String, timeout: Long = 30_000, condition: () -> Boolean) {
                val deadline = SystemClock.elapsedRealtime() + timeout
                while (SystemClock.elapsedRealtime() < deadline) {
                    if (condition()) return
                    Thread.sleep(150)
                }
                fail(message)
            }
            fun find(node: AccessibilityNodeInfo, predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
                if (node.className == "android.webkit.WebView") return null
                if (node.isVisibleToUser && predicate(node)) return node
                for (i in 0 until node.childCount) node.getChild(i)?.let { child -> find(child, predicate)?.let { return it } }
                return null
            }
            fun node(predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
                val root = instrumentation.uiAutomation.rootInActiveWindow ?: return null
                if (root.packageName?.toString() != instrumentation.targetContext.packageName) return null
                return find(root, predicate)
            }
            fun inputNode(value: AccessibilityNodeInfo) = value.isEditable || value.className == "android.widget.EditText" || value.actionList.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT }
            // A query and its exact-title result have the same text. The input is never a candidate.
            fun text(label: String) = node { !inputNode(it) && it.text?.toString()?.lineSequence()?.any { line -> line == label } == true }
            fun editor() = node { it.isEditable || it.className == "android.widget.EditText" }
            fun buttonEnabled(label: String): Boolean? {
                var candidate = text(label)
                while (candidate != null) {
                    if (candidate.isClickable) return candidate.isEnabled
                    candidate = candidate.parent
                }
                return null
            }
            fun click(label: String) {
                await("Could not click native $label", 15_000) {
                    var candidate = text(label)
                    while (candidate != null) {
                        if (!inputNode(candidate) && candidate.isClickable && candidate.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return@await true
                        candidate = candidate.parent
                    }
                    false
                }
                instrumentation.waitForIdleSync()
            }
            fun setQuery(query: String) {
                await("Native search input was not available") { editor() != null }
                val values = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, query) }
                assertTrue("Native search must accept editable text", editor()!!.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, values))
                await("Search text did not update") { editor()?.text?.toString()?.contains(query) == true }
            }
            fun findWebView(view: View): WebView? = when (view) {
                is WebView -> view
                is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { findWebView(view.getChildAt(it)) }
                else -> null
            }
            fun readerUrl(): String? {
                var value: String? = null
                instrumentation.runOnMainSync { value = findWebView(screen.window.decorView)?.url }
                return value
            }
            fun publicReaderUrl(): String = runCatching {
                val value = readerUrl() ?: return "unavailable"
                val uri = URI(value)
                if (UrlPolicy.wiki(value) == null) "non-Wikipedia" else "https://${uri.host}${uri.rawPath}"
            }.getOrDefault("unavailable")
            fun isArticle(url: String?, wiki: String, title: String): Boolean = runCatching {
                val uri = URI(url ?: return false)
                UrlPolicy.wiki(url) == wiki && uri.path == "/wiki/${title.replace(' ', '_')}"
            }.getOrDefault(false)
            fun livePageId(wiki: String, title: String): Long {
                val result = AtomicLong()
                val done = CountDownLatch(1)
                val host = if (wiki == "jawiki") "ja.wikipedia.org" else "en.wikipedia.org"
                val expression = "location.hostname === ${JSONObject.quote(host)} && decodeURIComponent(location.pathname) === ${JSONObject.quote("/wiki/${title.replace(' ', '_')}")} && document.querySelector('#mw-content-text') && window.mw?.config?.get('wgNamespaceNumber') === 0 ? (window.mw?.config?.get('wgArticleId') || 0) : 0"
                instrumentation.runOnMainSync {
                    val view = findWebView(screen.window.decorView)
                    if (view == null) done.countDown()
                    else view.evaluateJavascript(expression) { value -> result.set(value.toLongOrNull() ?: 0); done.countDown() }
                }
                return if (done.await(3, TimeUnit.SECONDS)) result.get() else 0
            }
            fun selectedArticle(wiki: String, title: String): HistoryEntry {
                try {
                    await("Selection must display the actual $wiki Reader URL") { text("検索") != null && isArticle(readerUrl(), wiki, title) }
                } catch (error: AssertionError) {
                    throw AssertionError("${error.message}; reader=${publicReaderUrl()}; search_input_present=${editor() != null}", error)
                }
                await("Selection must load a live eligible Wikipedia document", 45_000) { livePageId(wiki, title) > 0 }
                await("The live article must be remembered from its eligible DOM", 45_000) { history("viewed").any { it.wiki == wiki && isArticle(it.url, wiki, title) && (it.pageId ?: 0) > 0 } }
                val searched = history("searched", wiki).single { it.wiki == wiki && isArticle(it.url, wiki, title) }
                val viewed = history("viewed").single { it.wiki == wiki && isArticle(it.url, wiki, title) }
                assertEquals("Search result and real article DOM must identify the same page", searched.pageId, viewed.pageId)
                assertEquals("Existing history cannot substitute for the currently displayed DOM", searched.pageId, livePageId(wiki, title))
                assertEquals("Reselection must not create duplicate searched entries", 1, history("searched").count { identity(it) == identity(searched) })
                return searched
            }
            fun back() {
                instrumentation.runOnMainSync {
                    (screen.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(screen.window.decorView.windowToken, 0)
                }
                instrumentation.waitForIdleSync()
                Thread.sleep(300)
                instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            }
            fun showHistory() {
                await("Cleared input must show recent viewed history") { editor() != null && text("最近見た記事") != null }
                // The second section may be below existing rows in the real LazyColumn.
                repeat(12) {
                    if (text("最近検索した記事") != null) return
                    val width = screen.window.decorView.width.toFloat()
                    val height = screen.window.decorView.height.toFloat()
                    val start = SystemClock.uptimeMillis()
                    fun motion(action: Int, y: Float) {
                        val event = MotionEvent.obtain(start, SystemClock.uptimeMillis(), action, width / 2, y, 0)
                        instrumentation.sendPointerSync(event); event.recycle()
                    }
                    motion(MotionEvent.ACTION_DOWN, height * 0.78f)
                    for (i in 1..8) { Thread.sleep(25); motion(MotionEvent.ACTION_MOVE, height * (0.78f - i * 0.055f)) }
                    motion(MotionEvent.ACTION_UP, height * 0.34f)
                    instrumentation.waitForIdleSync()
                }
                fail("Empty input must show both recent-history sections")
            }

            await("Reader search button was not available") { text("検索") != null }
            await("Fresh Reader must disable both history buttons") { buttonEnabled("← 戻る") == false && buttonEnabled("進む →") == false }
            click("検索")
            showHistory()
            assertEquals(existingSearched, keys("searched"))
            back()
            await("OS back must close Search without finishing the Reader") { text("検索") != null && editor() == null }
            assertFalse(screen.isFinishing)

            for ((wiki, language, title) in listOf(Triple("jawiki", "日本語", "地球"), Triple("enwiki", "English", "Earth"))) {
                val beforeCandidates = keys("searched")
                click("検索")
                click(language)
                setQuery(title)
                await("Live $wiki search must show the exact article candidate", 45_000) { text("タイトル候補") != null && text(title) != null }
                assertEquals("Candidate display alone must not remember a searched article", beforeCandidates, keys("searched"))
                click(title)
                selectedArticle(wiki, title)
                assertTrue("Existing searched history must survive selection", keys("searched").containsAll(existingSearched))
                assertTrue("Existing viewed history must survive selection", keys("viewed").containsAll(existingViewed))
            }

            val beforeReselection = keys("searched")
            click("検索")
            click("English")
            setQuery("Earth")
            await("English candidate must be available for reselection", 45_000) { text("Earth") != null }
            click("×")
            showHistory()
            assertEquals("Clearing the query must not alter searched history", beforeReselection, keys("searched"))
            back()
            await("OS back from empty Search must retain the current article") { text("検索") != null && isArticle(readerUrl(), "enwiki", "Earth") }

            click("検索")
            click("English")
            setQuery("Earth")
            await("Reselection candidate must be available", 45_000) { text("Earth") != null && text("タイトル候補") != null }
            click("Earth")
            val reselected = selectedArticle("enwiki", "Earth")
            assertEquals("Reselection reorders an existing entry rather than adding another", beforeReselection, keys("searched"))
            assertEquals("Selected article must lead its language history", identity(reselected), identity(history("searched", "enwiki").first()))
            assertTrue(keys("viewed").containsAll(existingViewed))

            click("検索")
            click("English")
            setQuery("wikimfqa" + java.util.UUID.randomUUID().toString().replace("-", ""))
            Thread.sleep(1_000) // Allow the debounce to start before inspecting the finished empty response.
            await("An unmatched live search must show the empty-result state", 30_000) {
                text("結果はありません") != null && node { it.className == "android.widget.ProgressBar" } == null
            }
            assertEquals("An unmatched query cannot change article history", beforeReselection, keys("searched"))
            back()
            await("OS back after an empty result must retain Earth") { text("検索") != null && isArticle(readerUrl(), "enwiki", "Earth") }
            println("Native Search UI passed: live JA/EN candidates, no candidate-only history, selected URL/DOM identity, reselection, empty history, OS back; existing history preserved")
        } finally {
            activity?.let { screen -> instrumentation.runOnMainSync { screen.finish() }; instrumentation.waitForIdleSync() }
            settings.localConsent = originalConsent
            settings.language = originalLanguage
            store.close()
        }
    }
}
