package org.wikimf.reader

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

class PendingDiscardTest {
    private fun confirmation()=PendingDiscardConfirmation("fixture-device",PendingDiscardSnapshot("fixture-owner",setOf("event-a"),emptySet()))
    @Test fun cancelConsumesTheRequestAndCannotLaterConfirm() {
        val request=confirmation()
        assertTrue(request.claim())
        assertFalse("A cancelled dialog cannot be executed by a delayed click",request.claim())
    }
    @Test fun rapidRepeatedActionsCanClaimOnlyOneDecision() {
        val request=confirmation();val start=CountDownLatch(1);val decisions=AtomicInteger()
        val threads=List(16) { Thread { start.await();if(request.claim())decisions.incrementAndGet() }.apply { start() } }
        start.countDown();threads.forEach { it.join(2000);assertFalse("Test worker finished",it.isAlive) }
        assertEquals(1,decisions.get())
    }
}
