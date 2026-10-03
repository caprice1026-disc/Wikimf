package org.wikimf.reader

import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object RetryAfter {
    fun delayMillis(raw: String?, nowUtcMs: Long, fallbackMs: Long = 30_000): Long {
        val value = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return fallbackMs
        if (value.all { it in '0'..'9' }) {
            val seconds = value.toLongOrNull() ?: return fallbackMs
            return if (seconds > Long.MAX_VALUE / 1000) Long.MAX_VALUE else seconds * 1000
        }
        return runCatching {
            val deadline = ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
            if (deadline <= nowUtcMs) 0 else Math.subtractExact(deadline, nowUtcMs)
        }.getOrDefault(fallbackMs)
    }
}

/** One instance per process; caller supplies a monotonic clock independently of HTTP dates. */
class SearchCooldown {
    private val deadlines = mutableMapOf<String, Long>()
    @Synchronized fun block(wiki: String, nowMs: Long, delayMs: Long) {
        val delay = delayMs.coerceAtLeast(0)
        val deadline = if (delay > Long.MAX_VALUE - nowMs) Long.MAX_VALUE else nowMs + delay
        deadlines[wiki] = maxOf(deadlines[wiki] ?: 0, deadline)
    }
    @Synchronized fun remaining(wiki: String, nowMs: Long): Long {
        val deadline = deadlines[wiki] ?: return 0
        if (nowMs >= deadline) { deadlines.remove(wiki); return 0 }
        return deadline - nowMs
    }
}
