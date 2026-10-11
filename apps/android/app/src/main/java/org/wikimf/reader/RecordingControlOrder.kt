package org.wikimf.reader

/** One instance per preferences file, shared by Reader, workers and every Api/Settings instance. */
internal class RecordingControlOrder {
    val lock = Any()
    data class Ticket(val binding: Long, val sequence: Long)
    data class Permit(val binding: Long, val revision: Long)
    private var binding = 0L
    private var sequence = 0L
    private var revision = 0L
    private val calls = mutableMapOf<Any, Pair<Boolean, () -> Unit>>()

    fun begin(): Ticket = synchronized(lock) { Ticket(binding, ++sequence) }
    fun current(ticket: Ticket): Boolean = synchronized(lock) { ticket.binding == binding && ticket.sequence == sequence }
    fun permit(): Permit = synchronized(lock) { Permit(binding, revision) }
    fun current(permit: Permit, recording: Boolean = true): Boolean = synchronized(lock) {
        permit.binding == binding && (!recording || permit.revision == revision)
    }
    fun invalidate(bindingChanged: Boolean = false) = synchronized(lock) {
        if (bindingChanged) { binding++; sequence++ }
        revision++
        // Also cancel calls waiting in OkHttp's dispatcher, before they can transmit old URLs.
        calls.values.toList().filter { bindingChanged || it.first }.forEach { it.second() }
    }
    fun register(permit: Permit, recording: Boolean, cancel: () -> Unit): () -> Unit = synchronized(lock) {
        check(current(permit, recording))
        val key = Any()
        calls[key] = recording to cancel
        return@synchronized { synchronized(lock) { calls.remove(key); Unit } }
    }
}
