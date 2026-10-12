package org.wikimf.reader

import android.content.Context
import android.os.SystemClock
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiFailure(val code: Int, val errorCode: String, val retryAfterMs: Long = 0) : IOException(errorCode) {
    internal var permit: RecordingControlOrder.Permit? = null
    internal var controlTicket: RecordingControlOrder.Ticket? = null
    internal fun current(settings: Settings): Boolean = (permit?.let { settings.controlOrder.current(it) } != false) &&
        (controlTicket?.let { settings.controlOrder.current(it) } != false)
}

class Api(private val settings: Settings, private val http: OkHttpClient = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).followRedirects(false).build()) {
    private suspend fun <T> execute(
        request: Request, permit: RecordingControlOrder.Permit? = null, recording: Boolean = false,
        validate: () -> Unit = {}, consume: (Response) -> T
    ): T = suspendCancellableCoroutine { continuation ->
        try {
            settings.recordingLocked {
                if (!continuation.isActive) return@recordingLocked
                validate()
                val client = if (permit == null) http else http.newBuilder().addInterceptor { chain ->
                    // A call can wait in OkHttp after enqueue; check again at the HTTP boundary.
                    settings.recordingLocked { validate() }
                    chain.proceed(chain.request())
                }.build()
                val call = client.newCall(request)
                val unregister = permit?.let { settings.controlOrder.register(it, recording) { call.cancel() } } ?: {}
                continuation.invokeOnCancellation { call.cancel(); unregister() }
                call.enqueue(object : Callback {
                    override fun onFailure(call: Call, error: IOException) {
                        unregister()
                        val failure = try { settings.recordingLocked { validate() }; error } catch (changed: Exception) { changed }
                        if (continuation.isActive) continuation.resumeWithException(failure)
                    }
                    override fun onResponse(call: Call, response: Response) {
                        try {
                            // Consume delayed/chunked bodies on OkHttp's worker, never the UI thread.
                            val result = response.use(consume)
                            settings.recordingLocked { validate() }
                            if (continuation.isActive) continuation.resume(result)
                        } catch (error: Exception) {
                            val failure = try { settings.recordingLocked { validate() }; error } catch (changed: Exception) { changed }
                            if (continuation.isActive) continuation.resumeWithException(failure)
                        }
                        finally { unregister() }
                    }
                })
            }
        } catch (error: Exception) { if (continuation.isActive) continuation.resumeWithException(error) }
    }
    suspend fun request(path: String, body: JSONObject? = null, device: LinkedDevice? = settings.device(), control: RecordingControlSnapshot? = null): JSONObject {
        currentCoroutineContext().ensureActive()
        val recording = path in setOf("/articles/resolve", "/reading-events/batch")
        val (apiUrl, permit) = settings.recordingLocked { settings.apiUrl to (control?.permit ?: settings.controlOrder.permit()) }
        fun validate() {
            if (!settings.controlOrder.current(permit, recording = false) || settings.apiUrl != apiUrl || (device != null && device != settings.device())) throw ApiFailure(401, "device_binding_changed")
            if (recording) {
                if (device == null || !settings.cloudConsent || !settings.serverEnabled) throw ApiFailure(403, "recording_disabled")
                if (control == null || !settings.controlOrder.current(permit)) throw ApiFailure(409, "recording_control_superseded")
            }
        }
        require(validBase(apiUrl)) { if (BuildConfig.ALLOW_LAN_HTTP) "プライベートIPv4のLAN API URLを指定してください" else "API URLにはHTTPSを指定してください" }
        val builder = Request.Builder().url(apiUrl + path).header("Accept", "application/json")
        if (device != null) builder.header("Authorization", "Bearer ${device.token}")
        if (body != null) builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        val result = try { execute(builder.build(), permit, recording, ::validate) { response ->
            val raw = response.body?.string() ?: "{}"
            val json = runCatching { JSONObject(raw) }.getOrElse { throw ApiFailure(response.code, "invalid_server_response") }
            if (!response.isSuccessful) throw ApiFailure(response.code, json.optJSONObject("error")?.optString("code") ?: "http_${response.code}", (response.header("Retry-After")?.toLongOrNull() ?: 0) * 1000)
            json
        } } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            settings.recordingLocked { validate() }
            if (failure is ApiFailure) failure.permit = permit
            throw failure
        }
        currentCoroutineContext().ensureActive()
        settings.recordingLocked { validate() }
        return result
    }
    suspend fun refreshDashboardOrigin() {
        val expectedApi = settings.apiUrl
        try {
            val value = request("/config", device = null).optString("dashboard_url")
            val origin = DashboardUrls.configuredOrigin(expectedApi, value, BuildConfig.DEBUG, BuildConfig.ALLOW_LAN_HTTP) ?: return
            if (settings.apiUrl == expectedApi) settings.dashboardOrigin = origin
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            // Offline/older servers retain the cached origin or same-origin fallback.
        }
    }
    suspend fun recordingControl(store: LocalStore, device: LinkedDevice): RecordingControlSnapshot {
        currentCoroutineContext().ensureActive()
        val ticket = settings.recordingLocked {
            if (settings.device() != device) throw ApiFailure(401, "device_binding_changed")
            settings.controlOrder.begin()
        }
        val control = try { request("/me/recording-control", device = device) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (!settings.controlOrder.current(ticket)) throw ApiFailure(409, "recording_control_superseded")
            if (failure is ApiFailure) failure.controlTicket = ticket
            throw failure
        }
        currentCoroutineContext().ensureActive()
        return settings.recordingLocked {
            if (settings.device() != device) throw ApiFailure(401, "device_binding_changed")
            if (!settings.controlOrder.current(ticket)) throw ApiFailure(409, "recording_control_superseded")
            if (control.getString("user_id") != device.userId || control.getString("device_id") != device.deviceId) throw ApiFailure(403, "owner_mismatch").also { it.controlTicket = ticket }
            val epoch = control.getInt("recording_epoch")
            if (epoch < settings.epoch) throw ApiFailure(409, "recording_control_superseded")
            val enabled = control.getBoolean("collection_enabled")
            val markers = HistoryDeletion.merge(settings.deletionMarkers(), control.optJSONArray("deletion_markers") ?: JSONArray())
            // Validate order/ownership before any irreversible queue cleanup or settings publication.
            store.expire()
            store.discardEpoch(device.userId, epoch)
            store.discardDeleted(device.userId, markers)
            settings.saveControl(epoch, enabled, markers)
            RecordingControlSnapshot(epoch, markers, settings.controlOrder.permit())
        }
    }
    suspend fun resolveArticle(store: LocalStore, url: String, device: LinkedDevice): JSONObject {
        val control = recordingControl(store, device)
        return request("/articles/resolve", JSONObject().put("url", url), device, control)
    }
    suspend fun search(wiki: String, query: String, full: Boolean): List<HistoryEntry> {
        while (true) {
            val remaining = searchCooldown.remaining(wiki, SystemClock.elapsedRealtime())
            if (remaining == 0L) break
            delay(remaining)
        }
        currentCoroutineContext().ensureActive()
        val host = if (wiki == "jawiki") "ja" else "en"
        val url = "https://$host.wikipedia.org/w/rest.php/v1/search/${if (full) "page" else "title"}?q=${URLEncoder.encode(query.trim(), "UTF-8")}&limit=${if (full) 20 else 10}"
        return execute(Request.Builder().url(url).header("User-Agent", "wikimf/0.1.0 (Android reader)").build()) { response ->
            if (response.code == 429) {
                val wait = RetryAfter.delayMillis(response.header("Retry-After"), System.currentTimeMillis())
                searchCooldown.block(wiki, SystemClock.elapsedRealtime(), wait)
                throw ApiFailure(429, "wikipedia_429", wait)
            }
            if (!response.isSuccessful) throw ApiFailure(response.code, "wikipedia_${response.code}")
            val pages = JSONObject(response.body?.string() ?: "{}").getJSONArray("pages")
            List(pages.length()) { index ->
                val page = pages.getJSONObject(index)
                val key = page.getString("key")
                val description = page.optString("description").takeIf { it.isNotBlank() && it != "null" }
                    ?: page.optString("excerpt").replace(Regex("<[^>]*>"), "").takeIf { it.isNotBlank() }
                HistoryEntry(wiki, key, page.getString("title"), page.optLong("id").takeIf { it > 0 }, UrlPolicy.articleUrl(wiki, key), description)
            }
        }
    }
    companion object {
        private val searchCooldown = SearchCooldown()
        fun validBase(raw: String): Boolean = ApiUrls.validBase(raw, BuildConfig.DEBUG, BuildConfig.ALLOW_LAN_HTTP)
    }
}

class RecordingControlSnapshot internal constructor(val epoch: Int, val markers: JSONArray, internal val permit: RecordingControlOrder.Permit)

class SyncEngine(private val context: Context) {
    suspend fun sync(): Boolean = withContext(Dispatchers.IO) {
        val settings = Settings(context)
        val device = settings.device() ?: return@withContext true
        val binding = settings.controlOrder.permit()
        val store = LocalStore(context)
        val api = Api(settings)
        try {
            repeat(20) {
                val control = api.recordingControl(store, device)
                val markers = control.markers
                if (!settings.serverEnabled || !settings.cloudConsent) { settings.status = "クラウド記録停止中・未送信 ${store.count(device.userId)}件を端末で保持"; return@withContext true }
                val pendingBefore = store.pending(device)
                val rows = store.rows(device)
                val ready = mutableListOf<Pair<QueueRow, JSONObject>>()
                var size = 0
                for (row in rows) {
                    if (!SecurityPolicy.canSend(row.owner, row.device, device.userId, device.deviceId)) continue
                    var event = JSONObject(row.payload)
                    if (event.optInt("recording_epoch") != control.epoch) continue
                    if (row.pendingUrl != null) {
                        val article = try { api.request("/articles/resolve", JSONObject().put("url", row.pendingUrl), device, control) }
                        catch (failure: ApiFailure) {
                            val terminal = (failure.code == 404 && failure.errorCode == "article_not_found") ||
                                (failure.code in setOf(400, 422) && failure.errorCode in setOf("invalid_article_url", "unsupported_article_mode", "ambiguous_article_identifier", "invalid_page_id", "unsupported_article_url", "invalid_article_identifier"))
                            if (!terminal) throw failure
                            store.quarantine(row.id, failure.errorCode)
                            continue
                        }
                        if (!article.getBoolean("trackable")) { store.quarantine(row.id, "untrackable_article"); continue }
                        event.put("article_id", article.getString("article_id")).put("wiki", article.getString("wiki")).put("page_id", article.getLong("page_id"))
                        store.finalizePending(row.id, event)
                    }
                    if (store.deleted(event, markers)) { store.quarantine(row.id, "article_deleted"); continue }
                    val bytes = event.toString().toByteArray().size
                    if (size + bytes > 240 * 1024) break
                    size += bytes
                    ready.add(row to event)
                }
                if (ready.isEmpty()) {
                    settings.status = if (store.quarantined(device.userId) > 0) "隔離された記録 ${store.quarantined(device.userId)}件" else if (store.count(device.userId) > 0) "再送を待っています" else "同期済み"
                    if (settings.cloudConsent && settings.serverEnabled && store.pending(device) in 1 until pendingBefore) return@repeat
                    return@withContext !settings.cloudConsent || !settings.serverEnabled || store.pending(device) == 0
                }
                if (!settings.serverEnabled || !settings.cloudConsent) { settings.status = "クラウド記録停止中・未送信 ${store.count(device.userId)}件"; return@withContext true }
                submit(api, store, device, ready, control)
                settings.status = "未送信 ${store.count(device.userId)}件・隔離 ${store.quarantined(device.userId)}件"
                val pendingAfter = store.pending(device)
                if (pendingAfter == 0) return@withContext true
                if (pendingAfter >= pendingBefore) return@withContext false
            }
            false
        } catch (failure: Exception) {
            if (failure is kotlinx.coroutines.CancellationException) throw failure
            if (!settings.controlOrder.current(binding, recording = false) || settings.device() != device) return@withContext true
            if (failure is ApiFailure && failure.errorCode == "recording_control_superseded") return@withContext false
            if (failure is ApiFailure && failure.errorCode == "recording_disabled") { settings.status = "クラウド記録停止中・未送信 ${store.count(device.userId)}件を端末で保持"; return@withContext true }
            if (failure is ApiFailure && failure.code in setOf(401, 403)) { settings.recordingLocked { if (settings.controlOrder.current(binding, recording = false) && settings.device() == device && failure.current(settings)) { settings.status = "端末連携を確認してください"; settings.serverEnabled = false } }; return@withContext true }
            else settings.status = "同期保留・${store.count(device.userId)}件（再試行可能）"
            store.rows(device).forEach { store.retry(it) }
            false
        } finally { store.close() }
    }
    private suspend fun submit(api: Api, store: LocalStore, device: LinkedDevice, ready: List<Pair<QueueRow, JSONObject>>, control: RecordingControlSnapshot) {
        val response = try { api.request("/reading-events/batch", JSONObject().put("schema_version", 1).put("events", JSONArray(ready.map { it.second })), device, control) }
        catch (failure: ApiFailure) {
            when (failure.code) {
                413 -> {
                    if (ready.size == 1) store.quarantine(ready[0].first.id, "payload_too_large")
                    else { val midpoint = ready.size / 2; submit(api, store, device, ready.take(midpoint), control); submit(api, store, device, ready.drop(midpoint), control) }
                    return
                }
                422 -> { ready.forEach { store.quarantine(it.first.id, "schema_invalid") }; return }
                401, 403 -> throw failure
                else -> { ready.forEach { store.retry(it.first, failure.retryAfterMs) }; throw failure }
            }
        }
        val acknowledgements = response.getJSONArray("results")
        val byId = ready.associate { it.first.id to it.first }
        val received = mutableSetOf<String>()
        for (i in 0 until acknowledgements.length()) {
            val ack = acknowledgements.getJSONObject(i)
            val row = byId[ack.getString("event_id")] ?: continue
            received.add(row.id)
            when (ack.getString("status")) {
                "accepted", "duplicate" -> store.ack(row.id)
                else -> if (ack.optBoolean("retryable")) store.retry(row) else store.quarantine(row.id, ack.optString("code", "rejected"))
            }
        }
        ready.filter { it.first.id !in received }.forEach { store.retry(it.first) }
    }
    companion object {
        fun schedule(context: Context) {
            val work = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniqueWork("wikimf-sync", ExistingWorkPolicy.KEEP, work)
        }
    }
}
class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = if (SyncEngine(applicationContext).sync()) Result.success() else Result.retry()
}
