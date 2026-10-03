package org.wikimf.reader

import org.junit.Assert.*
import org.junit.Test

class DashboardUrlsTest {
    private val id = "12345678-1234-4234-8234-123456789abc"
    @Test fun dashboardRoutesUseThePublicFrontendOrigin() {
        val base = DashboardUrls.base("https://api.example/api/v1", "https://dashboard.example/", false)!!
        assertEquals("https://dashboard.example/app", DashboardUrls.overview(base))
        assertEquals("https://dashboard.example/app/settings/privacy", DashboardUrls.privacy(base))
        assertEquals("https://dashboard.example/app/articles/$id", DashboardUrls.article(base, id))
        assertEquals("https://dashboard.example/app/library", DashboardUrls.article(base, null))
        assertEquals("https://dashboard.example/app/library", DashboardUrls.article(base, "../settings"))
        assertEquals("https://api.example", DashboardUrls.base("https://api.example/api/v1", null, false))
    }
    @Test fun onlyDebugEmulatorMapsServerLoopbackToTheHostGateway() {
        val api = "http://10.0.2.2:8000/api/v1"
        val base = DashboardUrls.base(api, "http://localhost:5173", true)!!
        assertEquals("http://10.0.2.2:5173", base)
        assertEquals("http://10.0.2.2:5173/link-device/$id", DashboardUrls.pairing(api, base, "http://localhost:5173/link-device/$id", id, true))
        assertEquals("http://localhost:5173", DashboardUrls.base("http://localhost:8000/api/v1", "http://localhost:5173", true))
        assertNull(DashboardUrls.base(api, "http://localhost:5173", false))
        assertEquals("https://localhost:5173", DashboardUrls.base("https://api.example/api/v1", "https://localhost:5173", false))
    }
    @Test fun pairingRequiresConfiguredOriginAndTheDisplayedGrant() {
        val api = "https://api.example/api/v1"; val base = "https://dashboard.example"
        assertEquals("$base/link-device/$id", DashboardUrls.pairing(api, base, "$base:443/link-device/$id", id, false))
        assertEquals("$base/device-link?id=$id", DashboardUrls.pairing(api, base, "$base/device-link?id=$id", id, false))
        for (raw in listOf("https://evil.example/link-device/$id", "$base:8443/link-device/$id", "$base/link-device/00000000-0000-4000-8000-000000000000", "$base/link-device/$id?device_secret=secret", "$base/link-device/$id#x", "https://user@dashboard.example/link-device/$id", "http://dashboard.example/link-device/$id", "javascript:alert(1)", "$base/app/settings/privacy")) assertNull(raw, DashboardUrls.pairing(api, base, raw, id, false))
        for (raw in listOf("https://user@dashboard.example", "https://dashboard.example/path", "https://dashboard.example?x=1", "https://dashboard.example#x", "http://dashboard.example", "javascript:alert(1)")) assertNull(raw, DashboardUrls.configuredOrigin(api, raw, false))
    }
}
