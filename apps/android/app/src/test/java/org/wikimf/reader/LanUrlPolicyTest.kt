package org.wikimf.reader

import org.junit.Assert.*
import org.junit.Test

class LanUrlPolicyTest {
    @Test fun lanOptInOnlyAllowsNumericPrivateIpv4Http() {
        for (host in listOf("192.168.11.10", "10.42.0.5", "172.16.0.1", "172.31.255.254")) {
            val api = "http://$host:8080/api/v1"
            assertTrue(api, ApiUrls.validBase(api, false, true))
            assertFalse(api, ApiUrls.validBase(api, false, false))
            assertFalse(api, ApiUrls.validBase(api, true, false))
            assertEquals("http://$host:8080", DashboardUrls.base(api, null, false, true))
        }
        for (host in listOf("8.8.8.8", "example.com", "192.168.example.com", "192.168.011.10", "192.168.1.256", "172.15.1.1", "172.32.1.1", "169.254.1.1", "127.0.0.1", "[::1]")) {
            val api = "http://$host:8080/api/v1"
            assertFalse(api, ApiUrls.validBase(api, false, true))
            assertNull(api, DashboardUrls.base(api, null, false, true))
        }
        assertTrue(ApiUrls.validBase("http://10.0.2.2:8000/api/v1", true, false))
        assertTrue(ApiUrls.validBase("https://api.example/api/v1", false, false))
    }
    @Test fun apiAndPairingRejectCredentialAndOriginConfusion() {
        val api = "http://192.168.11.10:8080/api/v1"
        val base = "http://192.168.11.10:8080"
        val id = "12345678-1234-4234-8234-123456789abc"
        assertEquals("$base/link-device/$id", DashboardUrls.pairing(api, base, "$base/link-device/$id", id, false, true))
        for (raw in listOf("$api?x=1", "$api#x", "http://user@192.168.11.10:8080/api/v1", "http://192.168.11.10:0/api/v1", "http://192.168.11.10:99999/api/v1", "http://192.168.11.10:8080/evil/api/v1")) assertFalse(raw, ApiUrls.validBase(raw, false, true))
        for (raw in listOf("http://192.168.11.11:8080/link-device/$id", "$base:443/link-device/$id", "$base/link-device/$id?token=secret", "$base/link-device/$id#x")) assertNull(raw, DashboardUrls.pairing(api, base, raw, id, false, true))
    }
    @Test fun builtVariantMatchesItsDeclaredNetworkBoundary() {
        assertEquals(BuildConfig.ALLOW_LAN_HTTP, Api.validBase("http://192.168.11.10:8080/api/v1"))
        if (BuildConfig.ALLOW_LAN_HTTP) {
            assertFalse(BuildConfig.DEBUG)
            assertEquals(if (BuildConfig.BUILD_TYPE == "lanLocal") "org.wikimf.reader.lan.local" else "org.wikimf.reader.lan", BuildConfig.APPLICATION_ID)
        }
    }
}
