package org.wikimf.reader

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real WorkManager; exercise an enqueue after the running worker's last queue check. */
class SyncSchedulingRegressionTest {
    class EmptyCheckWorker(context:Context,parameters:WorkerParameters):Worker(context,parameters) {
        override fun doWork():Result {
            checkedEmpty.countDown()
            release.await(20,TimeUnit.SECONDS)
            return Result.success()
        }
    }
    companion object {
        var checkedEmpty=CountDownLatch(1)
        var release=CountDownLatch(1)
    }
    @Test fun aSignalDuringTheRunningWorkersFinalWindowSchedulesOneFollowup() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val manager=WorkManager.getInstance(context)
        manager.cancelUniqueWork("wikimf-sync").result.get(5,TimeUnit.SECONDS)
        checkedEmpty=CountDownLatch(1);release=CountDownLatch(1)
        val first=OneTimeWorkRequestBuilder<EmptyCheckWorker>().build()
        manager.enqueueUniqueWork("wikimf-sync",ExistingWorkPolicy.REPLACE,first).result.get(5,TimeUnit.SECONDS)
        try {
            assertTrue("Controlled worker reached its final window",checkedEmpty.await(10,TimeUnit.SECONDS))
            val before=manager.getWorkInfosForUniqueWork("wikimf-sync").get(5,TimeUnit.SECONDS).map{it.id}.toSet()
            repeat(10) { SyncEngine.schedule(context) }
            var followups=emptyList<WorkInfo>()
            repeat(50) {
                followups=manager.getWorkInfosForUniqueWork("wikimf-sync").get(5,TimeUnit.SECONDS).filter{it.id !in before}
                if(followups.isEmpty()) Thread.sleep(100)
            }
            assertEquals("Signals are coalesced to one guaranteed followup, not lost or piled up",1,followups.size)
            assertEquals(WorkInfo.State.BLOCKED,followups.single().state)
            release.countDown()
            var state=WorkInfo.State.BLOCKED
            repeat(100) {
                if(!state.isFinished) { state=manager.getWorkInfoById(followups.single().id).get(5,TimeUnit.SECONDS)!!.state;Thread.sleep(100) }
            }
            assertEquals(WorkInfo.State.SUCCEEDED,state)
        } finally { release.countDown();manager.cancelUniqueWork("wikimf-sync").result.get(5,TimeUnit.SECONDS) }
    }
}
