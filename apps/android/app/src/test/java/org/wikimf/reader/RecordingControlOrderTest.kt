package org.wikimf.reader

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RecordingControlOrderTest {
    @Test fun onlyLatestStartedControlMayPublishEvenIfLatestIsCanceled() {
        val order = RecordingControlOrder()
        val older = order.begin()
        val newer = order.begin()
        assertFalse(order.current(older))
        assertTrue(order.current(newer))
        // Cancellation/failure never restores an earlier ticket's authority.
        assertFalse(order.current(older))
        assertTrue(order.current(order.begin()))
    }

    @Test fun changedControlsCancelReadingCallsButKeepControlRefreshes() {
        val order = RecordingControlOrder()
        val permit = order.permit()
        var readingCanceled = false
        var controlCanceled = false
        order.register(permit, true) { readingCanceled = true }
        order.register(permit, false) { controlCanceled = true }
        order.invalidate()
        assertTrue(readingCanceled)
        assertFalse(controlCanceled)
        assertFalse(order.current(permit))
        assertTrue(order.current(permit, recording = false))
    }

    @Test fun replacementInvalidatesTicketsAndCallsEvenWhenSameOwnerIsRelinked() {
        val order = RecordingControlOrder()
        val ticket = order.begin()
        val permit = order.permit()
        var canceled = false
        order.register(permit, false) { canceled = true }
        order.invalidate(bindingChanged = true)
        assertFalse(order.current(ticket))
        assertFalse(order.current(permit, recording = false))
        assertTrue(canceled)
    }

    @Test fun finishedCallsAreNotCanceledAndInvalidPermitsCannotRegister() {
        val order = RecordingControlOrder()
        val permit = order.permit()
        var cancellations = 0
        order.register(permit, true) { cancellations++ }.invoke()
        order.invalidate()
        assertEquals(0, cancellations)
        try { order.register(permit, true) {}; fail("Stale permission registered") }
        catch (_: IllegalStateException) { }
    }

    @Test fun omittedOrOlderMarkersNeverRemoveNewerDeletionCutoffs() {
        fun markers(id: String, time: String) = JSONArray().put(JSONObject().put("article_id", id).put("deleted_before", time))
        val original = markers("A", "2026-10-11T10:00:00Z")
        val merged = HistoryDeletion.merge(original, markers("A", "2026-10-10T10:00:00Z"))
        assertEquals(HistoryDeletion.cutoff(original, "A"), HistoryDeletion.cutoff(merged, "A"))
        val retained = HistoryDeletion.merge(merged, markers("B", "2026-10-12T10:00:00Z"))
        assertEquals(2, retained.length())
        assertEquals(retained.toString(), HistoryDeletion.merge(retained, JSONArray()).toString())
    }
}
