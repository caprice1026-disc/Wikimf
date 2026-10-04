package org.wikimf.reader

import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Host approves the private ephemeral code through the actual QA Web session + CSRF API. */
@RunWith(AndroidJUnit4::class)
class PairingTransportIntegrationTest {
    @Test fun nativeStartWebApprovalNativeExchangeAndAuthenticatedMe() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("native_pairing_smoke") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext.createDeviceProtectedStorageContext()
        val settings = Settings(context)
        val originalApi = settings.apiUrl
        val verificationFile = context.filesDir.resolve("pairing-verification.json")
        val resultFile = context.filesDir.resolve("pairing-transport-result.json")
        verificationFile.delete(); resultFile.delete()
        try {
            settings.apiUrl = InstrumentationRegistry.getArguments().getString("pairing_api_url") ?: "http://10.0.2.2:8000/api/v1"
            settings.unlink()
            val api = Api(settings)
            val grant = api.request("/device-links", JSONObject().put("source", "android_reader").put("display_name", "Android pairing acceptance #14"), device = null)
            assertTrue(grant.getString("user_code").matches(Regex("[A-F0-9]{8}")))
            assertTrue(grant.getString("device_secret").isNotBlank())
            // The device secret stays in memory; this private file is read internally by the host helper.
            verificationFile.parentFile!!.mkdirs()
            verificationFile.writeText(JSONObject().put("link_id", grant.getString("link_id")).put("user_code", grant.getString("user_code")).toString())
            var exchanged: JSONObject? = null
            val deadline = SystemClock.elapsedRealtime() + 90_000
            while (exchanged == null && SystemClock.elapsedRealtime() < deadline) {
                try { exchanged = api.request("/device-links/${grant.getString("link_id")}/exchange", JSONObject().put("device_secret", grant.getString("device_secret")), device = null) }
                catch (failure: ApiFailure) {
                    assertTrue("Only pending/slow_down are retryable pairing responses", failure.code == 409 || failure.code == 429)
                    delay(maxOf(5_000, failure.retryAfterMs))
                }
            }
            val value = exchanged ?: error("Host did not approve the pairing grant before the deadline")
            val device = LinkedDevice(value.getString("user_id"), value.getString("device_id"), value.getString("token"), value.getString("display_name"))
            settings.saveDevice(device)
            assertFalse(settings.cloudConsent)
            val me = api.request("/me", device = device)
            assertEquals(device.userId, me.getString("user_id"))
            assertEquals(device.deviceId, me.getString("device_id"))
            resultFile.writeText(JSONObject().put("passed", true).put("user_id", device.userId).put("device_id", device.deviceId).put("source", "android_reader").toString())
        } finally { verificationFile.delete(); settings.unlink(); settings.apiUrl = originalApi }
    }
}
