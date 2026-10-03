package org.wikimf.reader

import java.net.URI

/** Browser links use the server's public Dashboard origin, independently of the API. */
object DashboardUrls {
    private val localHosts = setOf("localhost", "127.0.0.1", "10.0.2.2", "::1", "[::1]")
    private val uuid = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

    private fun origin(uri: URI, debug: Boolean): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (uri.rawUserInfo != null || uri.rawFragment != null || uri.port < -1 || uri.port > 65535) return null
        if (scheme != "https" && !(debug && scheme == "http" && host in localHosts)) return null
        val port = uri.port.takeUnless { it == (if (scheme == "https") 443 else 80) } ?: -1
        return URI(scheme, null, host, port, null, null, null).toString()
    }

    private fun emulatorOrigin(api: String, uri: URI, debug: Boolean): URI {
        val apiHost = runCatching { URI(api).host }.getOrNull()
        return if (debug && apiHost == "10.0.2.2" && uri.host?.lowercase() in localHosts - "10.0.2.2")
            URI(uri.scheme, null, "10.0.2.2", uri.port, uri.path, uri.query, uri.fragment)
        else uri
    }

    fun configuredOrigin(api: String, configured: String?, debug: Boolean): String? = runCatching {
        val uri = URI(configured ?: return null)
        if (uri.rawQuery != null || uri.rawPath !in listOf("", "/")) return null
        // Validate before rebuilding so userinfo cannot be stripped from an unsafe input.
        if (origin(uri, debug) == null) return null
        origin(emulatorOrigin(api, uri, debug), debug)
    }.getOrNull()

    fun base(api: String, configured: String?, debug: Boolean): String? = configuredOrigin(api, configured, debug)
        ?: runCatching { val uri = URI(api); if (uri.rawQuery != null) null else origin(uri, debug) }.getOrNull()

    fun overview(base: String) = "$base/app"
    fun privacy(base: String) = "$base/app/settings/privacy"
    fun article(base: String, id: String?) = if (id != null && uuid.matches(id)) "$base/app/articles/$id" else "$base/app/library"

    fun pairing(api: String, base: String, raw: String, linkId: String, debug: Boolean): String? = runCatching {
        if (!uuid.matches(linkId)) return null
        val uri = URI(raw)
        if (origin(uri, debug) == null) return null
        val mapped = emulatorOrigin(api, uri, debug)
        if (origin(mapped, debug) != base) return null
        val expected = uri.rawPath == "/link-device/$linkId" && uri.rawQuery == null
            || uri.rawPath == "/device-link" && uri.rawQuery == "id=$linkId"
        if (!expected) return null
        "$base${uri.rawPath}${uri.rawQuery?.let { "?$it" } ?: ""}"
    }.getOrNull()
}
