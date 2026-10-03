package org.wikimf.reader

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class SearchCooldownTest {
    @Test fun retryAfterParsesSecondsDateAndInvalidFallbackWithoutOverflow() {
        val now = Instant.parse("2026-10-04T00:00:00Z").toEpochMilli()
        assertEquals(12_000L, RetryAfter.delayMillis(" 12 ", now))
        assertEquals(12_000L, RetryAfter.delayMillis("Sun, 4 Oct 2026 00:00:12 GMT", now))
        assertEquals(0L, RetryAfter.delayMillis("Sun, 4 Oct 2026 00:00:00 GMT", now + 1000))
        assertEquals(0L, RetryAfter.delayMillis("0", now))
        assertEquals(Long.MAX_VALUE, RetryAfter.delayMillis(Long.MAX_VALUE.toString(), now))
        for (value in listOf(null, "", "-1", "1.5", "invalid", "999999999999999999999999")) assertEquals(value, 30_000L, RetryAfter.delayMillis(value, now))
    }
    @Test fun wikiDeadlineSurvivesScreenReopenAndCannotBeShortened() {
        val process = SearchCooldown()
        process.block("jawiki", 1000, 30_000)
        assertEquals(29_000L, process.remaining("jawiki", 2000))
        assertEquals(0L, process.remaining("enwiki", 2000))
        process.block("jawiki", 2000, 1000)
        assertEquals(28_000L, process.remaining("jawiki", 3000))
        // A newly opened screen shares the same process instance and absolute deadline.
        val reopenedScreen = process
        assertEquals(1L, reopenedScreen.remaining("jawiki", 30_999))
        assertEquals(0L, reopenedScreen.remaining("jawiki", 31_000))
        process.block("enwiki", 1000, Long.MAX_VALUE)
        assertEquals(Long.MAX_VALUE - 1000, process.remaining("enwiki", 1000))
    }
    @Test fun onlyTheLatestQueryRemainsCurrentDuringASharedWait() {
        val process = SearchCooldown(); process.block("jawiki", 1000, 30_000)
        val gate = SearchGate(); val previous = gate.next("jawiki", "old", false)
        val latest = gate.next("jawiki", "new", true)
        assertFalse(gate.current(previous)); assertTrue(gate.current(latest))
        assertTrue(process.remaining(latest.language, 2000) > 0)
        gate.cancel(); assertFalse(gate.current(latest))
        val reopened = SearchGate().next("jawiki", "new", false)
        assertTrue(process.remaining(reopened.language, 3000) > 0)
    }
}
