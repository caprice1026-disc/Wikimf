package org.wikimf.reader

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

object UrlPolicy {
    val origins = setOf("https://ja.wikipedia.org", "https://en.wikipedia.org")
    enum class Destination { READER, EXTERNAL, REJECT }
    fun classify(raw: String): Destination = runCatching {
        if (raw.any { it.isWhitespace() || it.code < 32 } || raw.contains('\\')) return Destination.REJECT
        val uri = URI(raw)
        if (uri.scheme?.lowercase() !in setOf("http", "https") || uri.host.isNullOrEmpty() || uri.rawUserInfo != null) return Destination.REJECT
        if (uri.port !in setOf(-1, 80, 443)) return Destination.REJECT
        if (uri.scheme.equals("https", true) && uri.host.lowercase() in setOf("ja.wikipedia.org", "en.wikipedia.org") && uri.port in setOf(-1, 443)) Destination.READER else Destination.EXTERNAL
    }.getOrDefault(Destination.REJECT)
    fun wiki(raw: String): String? = if (classify(raw) == Destination.READER) {
        if (URI(raw).host.equals("ja.wikipedia.org", true)) "jawiki" else "enwiki"
    } else null
    fun measurable(raw: String): Boolean = runCatching {
        if (classify(raw) != Destination.READER) return false
        val uri = URI(raw)
        val query = (uri.rawQuery ?: "").split('&').associate {
            val parts = it.split('=', limit = 2)
            URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
        }
        if (query.keys.any { it in setOf("oldid", "diff", "action", "veaction", "search") }) return false
        val title = if (uri.path.startsWith("/wiki/")) uri.path.removePrefix("/wiki/") else query["title"] ?: ""
        val currentId = uri.path == "/w/index.php" && query["curid"]?.toLongOrNull()?.let { it > 0 } == true
        val namespace = title.substringBefore(':').lowercase()
        val excluded = setOf("special", "category", "talk", "user", "user_talk", "wikipedia", "wikipedia_talk", "file", "image", "template", "help", "portal", "draft", "module", "特別", "カテゴリ", "カテゴリー", "ノート", "利用者", "利用者‐会話", "ファイル", "画像", "プロジェクト")
        currentId || (uri.path.startsWith("/wiki/") && !(title.contains(':') && namespace in excluded) && title !in setOf("Main_Page", "メインページ", ""))
    }.getOrDefault(false)
    fun articleUrl(wiki: String, key: String): String = "https://${if (wiki == "jawiki") "ja" else "en"}.wikipedia.org/wiki/" + URLEncoder.encode(key.replace(' ', '_'), "UTF-8").replace("+", "%20")
}

data class SearchRequest(val language: String, val query: String, val full: Boolean, val generation: Long)
class SearchGate {
    private var generation = 0L
    private var current: SearchRequest? = null
    fun next(language: String, query: String, full: Boolean): SearchRequest = SearchRequest(language, query.trim(), full, ++generation).also { current = it }
    fun current(request: SearchRequest) = current == request
    fun cancel() { generation++; current = null }
}

/** Pure owner and bridge checks are kept runnable without a WebView. */
object SecurityPolicy {
    fun acceptsBridge(origin: String, mainFrame: Boolean, payloadBytes: Int, documentUrl: String): Boolean =
        mainFrame && origin in UrlPolicy.origins && payloadBytes in 1..65_536 &&
            UrlPolicy.classify(documentUrl) == UrlPolicy.Destination.READER &&
            URI(documentUrl).host == URI(origin).host
    fun canSend(owner: String, device: String, activeOwner: String, activeDevice: String) = owner == activeOwner && device == activeDevice
    fun nextBackoff(attempt: Int): Long = (1_000L shl attempt.coerceIn(0, 10)).coerceAtMost(900_000L)
}
