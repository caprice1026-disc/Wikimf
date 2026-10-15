package org.wikimf.reader

import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.rememberCoroutineScope
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.UUID

/** Opt-in real Account UI with isolated DP data and a loopback stats response only. */
class PendingRecordUiRegressionTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private var lastClick="none"
    private fun bringForward(activity:MainActivity) {
        // Bring this exact fixture task forward; launching the component again
        // can create a fresh App and replace the injected Account content.
        instrumentation.uiAutomation.adoptShellPermissionIdentity(android.Manifest.permission.REORDER_TASKS)
        try {
            instrumentation.targetContext.getSystemService(android.app.ActivityManager::class.java).moveTaskToFront(activity.taskId,0)
        } finally { instrumentation.uiAutomation.dropShellPermissionIdentity() }
        await("The fixture Activity must own the focused window") {
            var focused=false;instrumentation.runOnMainSync { focused=activity.hasWindowFocus() };focused
        }
    }
    private fun find(node: AccessibilityNodeInfo, predicate:(AccessibilityNodeInfo)->Boolean): AccessibilityNodeInfo? {
        if (node.isVisibleToUser && predicate(node)) return node
        for(i in 0 until node.childCount) node.getChild(i)?.let { child -> find(child,predicate)?.let { return it } }
        return null
    }
    private fun text(label:String)=instrumentation.uiAutomation.rootInActiveWindow?.let { root ->
        find(root) { it.text?.toString()?.contains(label)==true }
    }
    private fun await(message:String, condition:()->Boolean) {
        repeat(100) { if(condition())return;Thread.sleep(100) }
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            java.io.File(instrumentation.targetContext.cacheDir,"pending-record-failure.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
            }
            bitmap.recycle()
        }
        error("$message; last fixture click: $lastClick")
    }
    private fun show(label:String):AccessibilityNodeInfo {
        repeat(15) {
            text(label)?.let { return it }
            instrumentation.uiAutomation.rootInActiveWindow?.let { root ->
                find(root) { it.isScrollable }?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            }
            Thread.sleep(150)
        }
        error("Account text did not appear: $label")
    }
    private fun click(label:String):AccessibilityNodeInfo {
        show(label)
        // ACTION_SCROLL_FORWARD animates, so Main idle alone does not mean
        // accessibility coordinates have stopped moving.
        instrumentation.uiAutomation.waitForIdle(200,5000)
        instrumentation.waitForIdleSync()
        var clicked:AccessibilityNodeInfo?=null
        await("Clickable target unavailable: $label") {
            // Account also has a non-clickable page heading; choose an actual action.
            var node=instrumentation.uiAutomation.rootInActiveWindow?.let { root -> find(root) { candidate ->
                if(candidate.text?.toString()!=label) false else {
                    var parent:AccessibilityNodeInfo?=candidate
                    while(parent!=null&&!parent.isClickable)parent=parent.parent
                    parent?.isEnabled==true
                }
            } }
            while(node!=null&&!node.isClickable)node=node.parent
            if(node!=null&&node.isEnabled){clicked=node;true}else false
        }
        // Use the same touch path as the independent review. Virtual Compose
        // ACTION_CLICK can return false while asynchronously opening a dialog.
        val bounds=android.graphics.Rect();clicked!!.getBoundsInScreen(bounds)
        val window=android.graphics.Rect();instrumentation.uiAutomation.rootInActiveWindow?.getBoundsInScreen(window)
        lastClick="$label bounds=$bounds window=$window"
        val down=android.os.SystemClock.uptimeMillis()
        for(action in listOf(android.view.MotionEvent.ACTION_DOWN,android.view.MotionEvent.ACTION_UP)) {
            val event=android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),action,bounds.exactCenterX(),bounds.exactCenterY(),0).apply { source=android.view.InputDevice.SOURCE_TOUCHSCREEN }
            try {assertTrue(instrumentation.uiAutomation.injectInputEvent(event,true))}finally{event.recycle()}
            if(action==android.view.MotionEvent.ACTION_DOWN)Thread.sleep(60)
        }
        instrumentation.waitForIdleSync()
        return clicked!!
    }
    private class Fixture(val settings:Settings,val store:LocalStore,val device:LinkedDevice,val other:LinkedDevice) {
        fun rows()=store.rows(device).associate { it.id to it.payload }
        fun add(device:LinkedDevice=this.device):String {
            val id=UUID.randomUUID().toString()
            assertTrue(store.enqueue(device,JSONObject().put("event_id",id).put("synthetic_progress",123),null))
            return id
        }
    }
    private fun fixture(quarantine:Boolean=true,appOwned:Boolean=false,block:(Fixture,MainActivity)->Unit) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("pending_record_ui")=="true")
        assertTrue("Use the dedicated Debug test variant",BuildConfig.DEBUG)
        assertTrue("Build the isolated UI app with -PwikimfIsolatedUiTest=true",BuildConfig.APPLICATION_ID=="org.wikimf.reader.uitest")
        val context=if(appOwned) instrumentation.targetContext else instrumentation.targetContext.createDeviceProtectedStorageContext()
        val settings=Settings(context)
        assertTrue("The isolated fixture must start unlinked; never replace existing credentials",settings.device()==null)
        val previousApi=settings.apiUrl;val previousCloud=settings.cloudConsent;val previousLocal=settings.localConsent
        val previousEnabled=settings.serverEnabled;val previousPause=settings.paused;val previousEpoch=settings.epoch
        val previousStatus=settings.status
        val previousMarkers=settings.deletionMarkers()
        val device=LinkedDevice(UUID.randomUUID().toString(),UUID.randomUUID().toString(),"synthetic-no-authority-token","Confirmation fixture")
        val other=LinkedDevice(UUID.randomUUID().toString(),UUID.randomUUID().toString(),"synthetic-no-authority-token","Other fixture")
        var activity:MainActivity?=null
        val store=LocalStore(context);val f=Fixture(settings,store,device,other)
        MockWebServer().use { server ->
            val body="""{"library":{"qualified_article_count":0,"state_counts":{"completed":0}},"activity":{"active_ms":0,"estimated_unique_read_chars":0}}"""
            repeat(10) { server.enqueue(MockResponse().setHeader("Content-Type","application/json").setBody(body)) }
            server.start()
            try {
                settings.apiUrl=server.url("/api/v1").toString();settings.saveDevice(device)
                settings.serverEnabled=true;settings.cloudConsent=false;settings.localConsent=true;settings.paused=false
                repeat(8) { f.add() };repeat(3) { f.add(other) }
                if(quarantine) store.quarantine(f.add(),"schema_invalid")
                store.quarantine(f.add(other),"schema_invalid")
                store.remember(device.userId,"recent",HistoryEntry(wiki="enwiki",key="confirmation-fixture",title="Retained fixture history",pageId=null,url="https://en.wikipedia.org/wiki/Imoni"))
                activity=instrumentation.startActivitySync(Intent(instrumentation.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)) as MainActivity
                block(f,activity)
            } finally {
                activity?.let { current ->
                instrumentation.runOnMainSync { current.finish() }
                // finish() schedules destruction; closing a DB still owned by a live Compose UI races its next frame.
                await("Fixture Activity must be destroyed before its external DB is closed") {
                    var destroyed=false;instrumentation.runOnMainSync { destroyed=current.isDestroyed };destroyed
                }
                instrumentation.waitForIdleSync()
                }
                store.discard(device.userId);store.discard(other.userId);store.clearHistory(device.userId);store.close()
                settings.unlink();settings.apiUrl=previousApi;settings.saveControl(previousEpoch,previousEnabled,previousMarkers)
                settings.cloudConsent=previousCloud;settings.localConsent=previousLocal;settings.paused=previousPause
                settings.status=previousStatus
            }
        }
    }
    private fun account(f:Fixture,activity:MainActivity) {
        instrumentation.runOnMainSync { activity.setContent { MaterialTheme {
            AccountScreen(instrumentation.targetContext.createDeviceProtectedStorageContext(),f.settings,f.store,f.device,rememberCoroutineScope(),openBrowser={},changed={},logout={})
        } } }
        bringForward(activity)
        await("Dedicated Account Activity must be foreground") {
            instrumentation.uiAutomation.rootInActiveWindow?.packageName?.toString()==instrumentation.targetContext.packageName
        }
        // The loopback stats response inserts content above the actions.
        // Wait for it before reading coordinates, rather than tapping an old layout.
        await("The fixture stats response must be visible") { text("自動判定のある記事数")!=null }
        instrumentation.uiAutomation.waitForIdle(200,5000)
        instrumentation.waitForIdleSync()
    }
    @Test fun emptyPendingRecordsShowNoTargetAndReactToNewRowsAndAck()=fixture(quarantine=false) { f,activity ->
        f.rows().keys.forEach(f.store::ack)
        account(f,activity)
        show("破棄する未送信記録・隔離診断はありません")
        assertNull(text("この端末の未送信記録を破棄"))
        val id=f.add()
        show("この端末の未送信記録を破棄")
        assertNull(text("破棄する未送信記録・隔離診断はありません"))
        click("この端末の未送信記録を破棄")
        await("New row must open its confirmation") { text("未送信記録を破棄しますか？")!=null && text("未送信 1件・隔離 0件")!=null }
        click("キャンセル");assertEquals(setOf(id),f.rows().keys)
        f.store.ack(id)
        show("破棄する未送信記録・隔離診断はありません")
        assertNull(text("この端末の未送信記録を破棄"))
        // Diagnostic-only data is still a valid discard target.
        val diagnostic=f.add();f.store.quarantine(diagnostic,"schema_invalid")
        show("この端末の未送信記録を破棄");click("この端末の未送信記録を破棄")
        await("Diagnostic-only confirmation must be explicit") { text("未送信記録を破棄しますか？")!=null && text("未送信 0件・隔離 1件")!=null }
        click("キャンセル");assertEquals(1,f.store.quarantined(f.device.userId))
    }
    @Test fun actualAccountRequiresConfirmationCancelPreservesPayloadAndDoubleConfirmKeepsOtherData()=fixture { f,activity ->
        account(f,activity);val original=f.rows();val otherRows=f.store.rows(f.other).associate { it.id to it.payload }
        click("この端末の未送信記録を破棄")
        await("Confirmation dialog missing") { text("未送信記録を破棄しますか？")!=null }
        assertNotNull(text("Confirmation fixture"));assertNotNull(text("未送信 8件・隔離 1件"));assertNotNull(text("元に戻せません"))
        assertEquals(original,f.rows());click("キャンセル")
        await("Cancel must close the dialog") { text("未送信記録を破棄しますか？")==null }
        assertEquals(original,f.rows());assertEquals(1,f.store.quarantined(f.device.userId))
        click("この端末の未送信記録を破棄")
        val confirm=click("破棄する");confirm.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        await("Confirmed records did not drain") { f.store.count(f.device.userId)==0 }
        assertEquals(0,f.store.quarantined(f.device.userId))
        assertEquals(otherRows,f.store.rows(f.other).associate { it.id to it.payload });assertEquals(1,f.store.quarantined(f.other.userId))
        assertTrue(f.store.history(f.device.userId,"recent","enwiki").any { it.title=="Retained fixture history" })
    }
    @Test fun sameCountWithDifferentEventIdsRequiresANewConfirmation()=fixture { f,activity ->
        account(f,activity);click("この端末の未送信記録を破棄")
        await("Initial confirmation snapshot must be visible") { text("未送信記録を破棄しますか？")!=null && text("未送信 8件・隔離 1件")!=null }
        f.store.ack(f.rows().keys.first());f.add();val replacement=f.rows()
        assertEquals(8,replacement.size);click("破棄する")
        assertEquals(replacement,f.rows());assertEquals(1,f.store.quarantined(f.device.userId))
        show("状態が変わりました")
    }
    @Test fun newlyQueuedEventRequiresANewConfirmation()=fixture { f,activity ->
        account(f,activity);click("この端末の未送信記録を破棄")
        await("Initial confirmation snapshot must be visible") { text("未送信記録を破棄しますか？")!=null && text("未送信 8件・隔離 1件")!=null }
        f.add();val changed=f.rows();click("破棄する")
        assertEquals(9,changed.size);assertEquals(changed,f.rows())
        show("状態が変わりました")
    }
    @Test fun permissionOrBindingChangesAndDelayedConfirmCannotEraseNewRows()=fixture { f,_ ->
        val original=f.rows()
        var confirmation=PendingDiscardConfirmation(f.device.deviceId,f.store.pendingDiscardSnapshot(f.device.userId))
        f.settings.cloudConsent=true
        assertFalse(confirmPendingDiscard(f.settings,f.store,confirmation));assertEquals(original,f.rows())
        f.settings.cloudConsent=false
        confirmation=PendingDiscardConfirmation(f.device.deviceId,f.store.pendingDiscardSnapshot(f.device.userId))
        f.settings.saveDevice(f.other)
        assertFalse(confirmPendingDiscard(f.settings,f.store,confirmation));assertEquals(original,f.rows())
        f.settings.saveDevice(f.device);f.settings.serverEnabled=true
        confirmation=PendingDiscardConfirmation(f.device.deviceId,f.store.pendingDiscardSnapshot(f.device.userId))
        assertTrue(confirmPendingDiscard(f.settings,f.store,confirmation));assertEquals(0,f.store.count(f.device.userId))
        f.add();val newRows=f.rows()
        assertFalse(confirmPendingDiscard(f.settings,f.store,confirmation));assertEquals(newRows,f.rows())
        assertEquals(3,f.store.count(f.other.userId));assertEquals(1,f.store.quarantined(f.other.userId))
    }
    @Test fun actualAccountShowsCurrentUnsentBeforePreviousSuccessAndUpdatesAfterAck()=fixture(quarantine=false) { f,activity ->
        f.settings.cloudConsent=true;f.settings.status="前回の同期完了"
        account(f,activity)
        show("同期状態: 未送信の記録があります（同期待ち）")
        assertNotNull(text("未送信 8件・隔離 0件"));show("現在の未送信記録はまだ同期されていません")
        f.rows().keys.forEach(f.store::ack)
        await("ACK must restore the empty-queue success display") { text("同期状態: 前回の同期完了")!=null }
        assertNotNull(text("未送信 0件・隔離 0件"));assertNull(text("現在の未送信記録はまだ同期されていません"))
    }
    @Test fun actualAppDestructionWithQueuedSyncNotificationsKeepsItsOwnedDatabaseLifecycleSafe() {
        repeat(3) { fixture(quarantine=false,appOwned=true) { f,activity ->
            bringForward(activity)
            await("Actual app must be foreground") { instrumentation.uiAutomation.rootInActiveWindow?.packageName?.toString()==instrumentation.targetContext.packageName }
            click("Account")
            show("未送信 8件・隔離 0件")
            val original=f.rows()
            repeat(5) { SyncUiUpdates.changed() }
            instrumentation.runOnMainSync { activity.finish() }
            repeat(5) { SyncUiUpdates.changed() }
            await("Actual app destruction timed out") { var destroyed=false;instrumentation.runOnMainSync { destroyed=activity.isDestroyed };destroyed }
            instrumentation.waitForIdleSync();SyncUiUpdates.changed();Thread.sleep(150)
            assertEquals(original,f.rows())
            assertFalse("Synthetic cloud consent remains OFF",f.settings.cloudConsent)
        } }
    }
}
