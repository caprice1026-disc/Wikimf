package org.wikimf.reader

import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Native owns the session; a frame can only submit bounded observations for it. */
class BridgeGuard {
    var sessionId: String = UUID.randomUUID().toString()
        private set
    private var lastSeq = -1L
    private var document: String? = null
    private var windowStart = 0L
    private var count = 0
    fun reset(): String { sessionId = UUID.randomUUID().toString(); lastSeq = -1; document = null; count = 0; return sessionId }
    fun accepts(event: JSONObject, now: Long): Boolean = runCatching {
        val allowed = setOf("schema_version", "event_id", "type", "device_id", "session_id", "session_started_at", "seq", "source", "article_id", "wiki", "page_id", "recording_epoch", "occurred_at", "interval", "document", "progress", "client_version", "measurement_policy_version", "reason")
        if (event.keys().asSequence().any { it !in allowed }) return false
        if (event.has("schema_version") && event.get("schema_version") != 1) return false
        if (now - windowStart >= 60_000) { windowStart = now; count = 0 }
        if (++count > 120 || event.getString("session_id") != sessionId) return false
        UUID.fromString(event.getString("event_id"))
        if (!integer(event.get("seq"))) return false
        val seq = event.getLong("seq")
        if (seq <= lastSeq || seq < 0 || (lastSeq < 0 && (seq != 0L || event.getString("type") != "session.opened"))) return false
        if (event.getString("type") !in setOf("session.opened", "reading.observed", "session.closed")) return false
        val started = Instant.parse(event.getString("session_started_at"))
        val occurred = Instant.parse(event.getString("occurred_at"))
        if (occurred < started || occurred.toEpochMilli() > now + 300_000 || started.toEpochMilli() < now - 7L * 86_400_000L) return false
        val doc = event.getJSONObject("document")
        if (doc.keys().asSequence().any { it !in setOf("fingerprint", "extractor_version", "observed_revision_id", "text_chars", "chunk_chars") } || doc.getString("extractor_version") != "prose-v1") return false
        if (!doc.isNull("fingerprint") && !Regex("^[a-f0-9]{64}$").matches(doc.getString("fingerprint"))) return false
        if (!doc.isNull("text_chars") && !integer(doc.get("text_chars"))) return false
        val signature = listOf("fingerprint", "extractor_version", "text_chars", "chunk_chars").joinToString("|") { doc.get(it).toString() }
        if (document != null && document != signature) return false
        val chunks = doc.getJSONArray("chunk_chars")
        if (chunks.length() > 5000) return false
        var total = 0L
        for (i in 0 until chunks.length()) { if (!integer(chunks.get(i)) || chunks.getLong(i) <= 0) return false; total += chunks.getLong(i) }
        if (total > 1_000_000 || (!doc.isNull("text_chars") && total != doc.getLong("text_chars"))) return false
        val interval = event.getJSONObject("interval")
        val duration = Instant.parse(interval.getString("end_at")).toEpochMilli() - Instant.parse(interval.getString("start_at")).toEpochMilli()
        if (duration < 0 || (event.getString("type") == "reading.observed" && duration == 0L)) return false
        var end = 0L
        val spans = interval.getJSONArray("active_spans_ms")
        for (i in 0 until spans.length()) {
            val span = spans.getJSONArray(i)
            if (!integer(span.get(0)) || !integer(span.get(1))) return false
            if (span.length() != 2 || span.getLong(0) < end || span.getLong(1) <= span.getLong(0) || span.getLong(1) > duration) return false
            end = span.getLong(1)
        }
        val progress = event.getJSONObject("progress")
        if (!integer(progress.get("active_ms_total")) || progress.getLong("active_ms_total") < 0 || progress.getString("measurement_status") !in setOf("ok", "time_only")) return false
        val covered = progress.getJSONArray("covered_chunk_ids")
        for (i in 0 until covered.length()) if (!integer(covered.get(i)) || covered.getInt(i) !in 0 until chunks.length()) return false
        if (progress.getString("measurement_status") == "time_only" && (!doc.isNull("fingerprint") || !doc.isNull("text_chars") || chunks.length() != 0 || covered.length() != 0 || progress.optString("reason_code").isBlank())) return false
        document = signature; lastSeq = seq
        true
    }.getOrDefault(false)
    private fun integer(value: Any): Boolean = value is Int || value is Long
}
