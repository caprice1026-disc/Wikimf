package org.wikimf.reader

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BoundaryTest {
    @Test fun strictNavigationAndArticleEligibility() {
        assertEquals(UrlPolicy.Destination.READER, UrlPolicy.classify("https://ja.wikipedia.org/wiki/東京"))
        assertEquals(UrlPolicy.Destination.READER, UrlPolicy.classify("https://en.wikipedia.org:443/wiki/Example"))
        for (url in listOf("javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "intent://x", "https://user@ja.wikipedia.org/wiki/X", "https://ja.wikipedia.org:8443/wiki/X", "https://ja.wikipedia.org/%ZZ", "https://ja.wikipedia.org\\@evil.test/wiki/X")) assertEquals(url, UrlPolicy.Destination.REJECT, UrlPolicy.classify(url))
        for (url in listOf("https://ja.wikipedia.org.example.com/wiki/X", "http://ja.wikipedia.org/wiki/X", "https://www.wikipedia.org", "https://de.wikipedia.org/wiki/X")) assertEquals(url, UrlPolicy.Destination.EXTERNAL, UrlPolicy.classify(url))
        assertTrue(UrlPolicy.measurable("https://en.wikipedia.org/wiki/Example#History"))
        assertTrue(UrlPolicy.measurable("https://en.wikipedia.org/w/index.php?curid=123"))
        for (url in listOf("https://en.wikipedia.org/wiki/Main_Page", "https://ja.wikipedia.org/wiki/メインページ", "https://en.wikipedia.org/wiki/Special:Search", "https://en.wikipedia.org/wiki/Example?oldid=10", "https://en.wikipedia.org/wiki/Example?action=edit", "https://en.wikipedia.org/w/index.php?curid=-1")) assertFalse(url, UrlPolicy.measurable(url))
        assertEquals("https://ja.wikipedia.org/wiki/地球", UrlPolicy.initialUrl("https://ja.wikipedia.org/wiki/地球", "enwiki"))
        assertEquals("https://en.wikipedia.org/wiki/Main_Page", UrlPolicy.initialUrl("", "enwiki"))
        assertEquals("https://ja.wikipedia.org/wiki/メインページ", UrlPolicy.initialUrl("https://untrusted.example/", "jawiki"))
    }
    @Test fun onlyTrustedMainFrameAndBoundOwnerCanReachQueue() {
        assertTrue(SecurityPolicy.acceptsBridge("https://ja.wikipedia.org", true, 100, "https://ja.wikipedia.org/wiki/X"))
        assertFalse(SecurityPolicy.acceptsBridge("https://ja.wikipedia.org", false, 100, "https://ja.wikipedia.org/wiki/X"))
        assertFalse(SecurityPolicy.acceptsBridge("https://evil.test", true, 100, "https://ja.wikipedia.org/wiki/X"))
        assertFalse(SecurityPolicy.acceptsBridge("https://ja.wikipedia.org", true, 65_537, "https://ja.wikipedia.org/wiki/X"))
        assertFalse(SecurityPolicy.acceptsBridge("https://en.wikipedia.org", true, 100, "https://ja.wikipedia.org/wiki/X"))
        assertTrue(SecurityPolicy.canSend("alice", "phone", "alice", "phone"))
        assertFalse(SecurityPolicy.canSend("alice", "phone", "bob", "phone"))
        assertFalse(SecurityPolicy.canSend("alice", "phone", "alice", "other"))
    }
    @Test fun canceledOrOldLanguageResponsesCannotOverwriteCurrentSearch() {
        val gate = SearchGate()
        val japanese = gate.next("jawiki", " 東京 ", false)
        val english = gate.next("enwiki", "東京", false)
        assertEquals("東京", japanese.query)
        assertFalse(gate.current(japanese))
        assertTrue(gate.current(english))
        val full = gate.next("enwiki", "東京", true)
        assertFalse(gate.current(english))
        assertTrue(gate.current(full))
        gate.cancel(); assertFalse(gate.current(full))
    }
    @Test fun fakeSessionDuplicateSeqAndInvalidIntervalsAreRejected() {
        val guard = BridgeGuard()
        val now = java.time.Instant.parse("2026-10-04T00:00:00Z").toEpochMilli()
        fun opened(session: String = guard.sessionId): JSONObject = JSONObject().put("event_id", "10000000-0000-4000-8000-000000000001")
            .put("type", "session.opened").put("session_id", session).put("seq", 0).put("session_started_at", "2026-10-04T00:00:00Z").put("occurred_at", "2026-10-04T00:00:00Z")
            .put("document", JSONObject().put("fingerprint", JSONObject.NULL).put("extractor_version", "prose-v1").put("text_chars", JSONObject.NULL).put("chunk_chars", JSONArray()))
            .put("interval", JSONObject().put("start_at", "2026-10-04T00:00:00Z").put("end_at", "2026-10-04T00:00:00Z").put("active_spans_ms", JSONArray()))
            .put("progress", JSONObject().put("active_ms_total", 0).put("measurement_status", "time_only").put("reason_code", "extraction_failed").put("covered_chunk_ids", JSONArray()))
        assertFalse(guard.accepts(opened("00000000-0000-4000-8000-000000000000"), now))
        assertTrue(guard.accepts(opened(), now))
        assertFalse(guard.accepts(opened(), now))
        val event = opened().put("type", "reading.observed").put("seq", 1)
        event.getJSONObject("interval").put("end_at", "2026-10-04T00:00:01Z").put("active_spans_ms", JSONArray("[[0,2000]]"))
        assertFalse(guard.accepts(event, now + 1000))
        event.getJSONObject("interval").put("active_spans_ms", JSONArray("[[0,1000]]"))
        assertTrue(guard.accepts(event, now + 1000))
        val boundary = opened().put("type", "reading.observed").put("seq", 2).put("occurred_at", "2026-10-04T00:01:00Z")
        boundary.getJSONObject("interval").put("end_at", "2026-10-04T00:01:00Z")
        assertTrue("The API permits a 60,000 ms interval", guard.accepts(boundary, now + 60_000))
        boundary.put("seq", 3).put("occurred_at", "2026-10-04T00:01:00.001Z")
        boundary.getJSONObject("interval").put("end_at", "2026-10-04T00:01:00.001Z")
        assertFalse("Overlong intervals must never reach the durable queue", guard.accepts(boundary, now + 60_001))
        boundary.put("type", "session.closed").put("reason", "pause").put("occurred_at", "2026-10-04T00:01:00Z")
        boundary.getJSONObject("interval").put("start_at", "2026-10-04T00:01:00Z").put("end_at", "2026-10-04T00:01:00Z")
        assertTrue("An empty closing interval is valid", guard.accepts(boundary, now + 60_000))
        assertTrue(SecurityPolicy.nextBackoff(100) <= 900_000)
    }
}
