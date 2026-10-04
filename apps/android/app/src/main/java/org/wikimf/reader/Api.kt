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
import java.net.URI
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiFailure(val code: Int, val errorCode: String, val retryAfterMs: Long = 0) : IOException(errorCode)

class Api(private val settings: Settings) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).followRedirects(false).build()
    private suspend fun execute(request: Request): Response = suspendCancellableCoroutine { continuation ->
        val call = http.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) { if (!continuation.isCancelled) continuation.resumeWithException(error) }
            override fun onResponse(call: Call, response: Response) { continuation.resume(response) { _, value, _ -> value.close() } }
        })
    }
    suspend fun request(path: String, body: JSONObject? = null, device: LinkedDevice? = settings.device()): JSONObject {
        val apiUrl = settings.apiUrl
        require(validBase(apiUrl)) { "API URLにはHTTPSを指定してください" }
        if (device != null && device != settings.device()) throw ApiFailure(401, "device_binding_changed")
        if (path in setOf("/articles/resolve", "/reading-events/batch") && (device == null || !settings.cloudConsent || !settings.serverEnabled)) throw ApiFailure(403, "recording_disabled")
        val builder = Request.Builder().url(apiUrl + path).header("Accept", "application/json")
        if (device != null) builder.header("Authorization", "Bearer ${device.token}")
        if (body != null) builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        return execute(builder.build()).use { response ->
            val raw = response.body?.string() ?: "{}"
            val json = runCatching { JSONObject(raw) }.getOrElse { throw ApiFailure(response.code, "invalid_server_response") }
            if (!response.isSuccessful) throw ApiFailure(response.code, json.optJSONObject("error")?.optString("code") ?: "http_${response.code}", (response.header("Retry-After")?.toLongOrNull() ?: 0) * 1000)
            json
        }
    }
    suspend fun refreshDashboardOrigin() {
        val expectedApi = settings.apiUrl
        try {
            val value = request("/config", device = null).optString("dashboard_url")
            val origin = DashboardUrls.configuredOrigin(expectedApi, value, BuildConfig.DEBUG) ?: return
            if (settings.apiUrl == expectedApi) settings.dashboardOrigin = origin
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            // Offline/older servers retain the cached origin or same-origin fallback.
        }
    }
    suspend fun recordingControl(store: LocalStore, device: LinkedDevice): JSONArray {
        store.expire()
        val control = request("/me/recording-control", device = device)
        if (control.getString("user_id") != device.userId || control.getString("device_id") != device.deviceId) throw ApiFailure(403, "owner_mismatch")
        settings.epoch = control.getInt("recording_epoch")
        settings.serverEnabled = control.getBoolean("collection_enabled")
        store.discardEpoch(device.userId, settings.epoch)
        val markers = control.optJSONArray("deletion_markers") ?: JSONArray()
        store.discardDeleted(device.userId, markers)
        return markers
    }
    suspend fun resolveArticle(store: LocalStore, url: String, device: LinkedDevice): JSONObject {
        recordingControl(store, device)
        return request("/articles/resolve", JSONObject().put("url", url), device)
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
        return execute(Request.Builder().url(url).header("User-Agent", "wikimf/0.1.0 (Android reader)").build()).use { response ->
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
        fun validBase(raw: String): Boolean = runCatching {
            val uri = URI(raw)
            val secure = uri.scheme == "https" || (BuildConfig.DEBUG && uri.scheme == "http" && uri.host in setOf("10.0.2.2", "localhost", "127.0.0.1"))
            secure && uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && raw.trimEnd('/').endsWith("/api/v1")
        }.getOrDefault(false)
    }
}

class SyncEngine(private val context: Context) {
    suspend fun sync(): Boolean = withContext(Dispatchers.IO) {
        val settings = Settings(context)
        val device = settings.device() ?: return@withContext true
        val store = LocalStore(context)
        val api = Api(settings)
        try {
            val markers = api.recordingControl(store, device)
            if (!settings.serverEnabled || !settings.cloudConsent) { settings.status = "クラウド記録停止中・未送信 ${store.count(device.userId)}件を端末で保持"; return@withContext true }
            val rows = store.rows(device)
            val ready = mutableListOf<Pair<QueueRow, JSONObject>>()
            var size = 0
            for (row in rows) {
                if (!SecurityPolicy.canSend(row.owner, row.device, device.userId, device.deviceId)) continue
                var event = JSONObject(row.payload)
                if (row.pendingUrl != null) {
                    val article = api.request("/articles/resolve", JSONObject().put("url", row.pendingUrl), device)
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
            if (ready.isEmpty()) { settings.status = if (store.quarantined(device.userId) > 0) "隔離された記録 ${store.quarantined(device.userId)}件" else if (store.count(device.userId) > 0) "再送を待っています" else "同期済み"; return@withContext !settings.cloudConsent || !settings.serverEnabled || store.count(device.userId) == 0 }
            if (!settings.serverEnabled || !settings.cloudConsent) { settings.status = "クラウド記録停止中・未送信 ${store.count(device.userId)}件"; return@withContext true }
            submit(api, store, device, ready)
            settings.status = "未送信 ${store.count(device.userId)}件・隔離 ${store.quarantined(device.userId)}件"
            true
        } catch (failure: Exception) {
            if (failure is kotlinx.coroutines.CancellationException) throw failure
            if (failure is ApiFailure && failure.errorCode == "recording_disabled") { settings.status = "クラウド記録停止中・未送信 ${store.count(device.userId)}件を端末で保持"; return@withContext true }
            if (failure is ApiFailure && failure.code in setOf(401, 403)) { settings.status = "端末連携を確認してください"; settings.serverEnabled = false; return@withContext true }
            else settings.status = "同期保留・${store.count(device.userId)}件（再試行可能）"
            store.rows(device).forEach { store.retry(it) }
            false
        } finally { store.close() }
    }
    private suspend fun submit(api: Api, store: LocalStore, device: LinkedDevice, ready: List<Pair<QueueRow, JSONObject>>) {
        val response = try { api.request("/reading-events/batch", JSONObject().put("schema_version", 1).put("events", JSONArray(ready.map { it.second })), device) }
        catch (failure: ApiFailure) {
            when (failure.code) {
                413 -> {
                    if (ready.size == 1) store.quarantine(ready[0].first.id, "payload_too_large")
                    else { val midpoint = ready.size / 2; submit(api, store, device, ready.take(midpoint)); submit(api, store, device, ready.drop(midpoint)) }
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
