package org.wikimf.reader

import java.net.URI

/** HTTP opt-in is explicit per variant; no DNS lookup or public HTTP destination. */
object ApiUrls {
    private val debugHosts = setOf("10.0.2.2", "localhost", "127.0.0.1", "::1", "[::1]")
    fun privateIpv4(host: String): Boolean {
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { !it.matches(Regex("0|[1-9][0-9]{0,2}")) }) return false
        val bytes = parts.map { it.toInt() }
        if (bytes.any { it !in 0..255 }) return false
        return bytes[0] == 10 || bytes[0] == 192 && bytes[1] == 168 || bytes[0] == 172 && bytes[1] in 16..31
    }
    fun transportAllowed(uri: URI, debug: Boolean, lan: Boolean): Boolean = uri.scheme.equals("https", true) ||
        uri.scheme.equals("http", true) && (debug && uri.host in debugHosts || lan && privateIpv4(uri.host ?: ""))

    fun validBase(raw: String, debug: Boolean, lan: Boolean): Boolean = runCatching {
        if (raw.any { it.isWhitespace() || it.code < 32 } || raw.contains('\\')) return false
        val uri = URI(raw)
        transportAllowed(uri, debug, lan) && uri.host != null && uri.rawUserInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null && uri.port in -1..65535 && uri.port != 0 &&
            uri.rawPath.trimEnd('/') == "/api/v1"
    }.getOrDefault(false)
}
