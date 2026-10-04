package org.wikimf.reader

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.SystemClock
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Explicit local-service test; captures real Compose button browser intents without signing in. */
@RunWith(AndroidJUnit4::class)
class DashboardLinkIntegrationTest {
    @Test fun managementButtonsUseTheConfiguredPublicOrigin() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("native_dashboard_smoke") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val settings = Settings(instrumentation.targetContext)
        val arguments = InstrumentationRegistry.getArguments()
        val expectedApi = arguments.getString("dashboard_api_url") ?: "http://10.0.2.2:8000/api/v1"
        val expectedOrigin = arguments.getString("dashboard_origin") ?: "http://10.0.2.2:5173"
        assertEquals(expectedApi, settings.apiUrl)
        Api(settings).refreshDashboardOrigin()
        assertEquals(expectedOrigin, settings.dashboardOrigin)
        val intents = LinkedBlockingQueue<String>()
        val monitor = object : Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                if (intent.action != Intent.ACTION_VIEW) return null
                intents.offer(intent.dataString ?: "")
                return Instrumentation.ActivityResult(Activity.RESULT_CANCELED, Intent())
            }
        }
        instrumentation.addMonitor(monitor)
        val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            fun scroll() {
                val width = activity.window.decorView.width.toFloat()
                val height = activity.window.decorView.height.toFloat()
                val start = SystemClock.uptimeMillis()
                fun motion(action: Int, y: Float) { val event = MotionEvent.obtain(start, SystemClock.uptimeMillis(), action, width / 2, y, 0); instrumentation.sendPointerSync(event); event.recycle() }
                motion(MotionEvent.ACTION_DOWN, height * 0.78f)
                for (i in 1..10) { Thread.sleep(25); motion(MotionEvent.ACTION_MOVE, height * (0.78f - i * 0.048f)) }
                motion(MotionEvent.ACTION_UP, height * 0.30f)
            }
            fun matches(node: AccessibilityNodeInfo, text: String): List<AccessibilityNodeInfo> {
                if (node.className == "android.webkit.WebView") return emptyList()
                val found = mutableListOf<AccessibilityNodeInfo>()
                if (node.isVisibleToUser && node.text?.toString() == text) found.add(node)
                for (i in 0 until node.childCount) node.getChild(i)?.let { found.addAll(matches(it, text)) }
                return found
            }
            fun click(text: String) {
                repeat(20) {
                    instrumentation.uiAutomation.waitForIdle(300, 3000)
                    val root = instrumentation.uiAutomation.rootInActiveWindow ?: return@repeat
                    if (root.packageName?.toString() != instrumentation.targetContext.packageName) return@repeat
                    for (found in matches(root, text)) {
                        var node: AccessibilityNodeInfo? = found
                        while (node != null) {
                            if (node.isClickable && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return
                            node = node.parent
                        }
                    }
                    scroll()
                }
                fail("Could not click $text")
            }
            // A finished Reader Activity can leave stale virtual nodes during the next transition.
            instrumentation.waitForIdleSync()
            val accountDeadline = SystemClock.elapsedRealtime() + 10_000
            do {
                click("Account")
                Thread.sleep(300)
                val root = instrumentation.uiAutomation.rootInActiveWindow
                if (root != null && matches(root, "端末内の記事履歴を保存").isNotEmpty()) break
                assertTrue("Account content did not appear", SystemClock.elapsedRealtime() < accountDeadline)
            } while (true)
            click("Dashboardを開く")
            val overview = intents.poll(3, TimeUnit.SECONDS)
            assertEquals("$expectedOrigin/app", overview)
            println("Captured ACTION_VIEW $overview")
            click("全端末の記録停止・削除・export・公開設定")
            val privacy = intents.poll(3, TimeUnit.SECONDS)
            assertEquals("$expectedOrigin/app/settings/privacy", privacy)
            println("Captured ACTION_VIEW $privacy")
        } finally {
            instrumentation.removeMonitor(monitor)
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
