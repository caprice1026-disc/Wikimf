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

/** Explicit temporary Reader QA linkage. The host backs up and restores original encrypted preferences. */
@RunWith(AndroidJUnit4::class)
class EmulatorQaPreparationTest {
    @Test fun prepareIsolatedReaderAccount() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("emulator_qa_prepare") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val settings = Settings(context)
        val codeFile = context.filesDir.resolve("emulator-qa-grant.json")
        val resultFile = context.filesDir.resolve("emulator-qa-result.json")
        codeFile.delete(); resultFile.delete()
        settings.apiUrl = args.getString("qa_api_url") ?: error("Explicit local QA API URL required")
        settings.unlink()
        try {
            val api = Api(settings)
            val grant = api.request("/device-links", JSONObject().put("source", "android_reader").put("display_name", "Emulator live ST"), device = null)
            codeFile.writeText(JSONObject().put("link_id", grant.getString("link_id")).put("user_code", grant.getString("user_code")).toString())
            var exchanged: JSONObject? = null
            val deadline = SystemClock.elapsedRealtime() + 90_000
            while (exchanged == null && SystemClock.elapsedRealtime() < deadline) {
                try { exchanged = api.request("/device-links/${grant.getString("link_id")}/exchange", JSONObject().put("device_secret", grant.getString("device_secret")), device = null) }
                catch (failure: ApiFailure) { assertTrue(failure.code in setOf(409, 429)); delay(maxOf(5_000, failure.retryAfterMs)) }
            }
            val value = exchanged ?: error("Host approval timeout")
            val device = LinkedDevice(value.getString("user_id"), value.getString("device_id"), value.getString("token"), value.getString("display_name"))
            settings.saveDevice(device); settings.epoch = value.getInt("recording_epoch")
            assertFalse(settings.cloudConsent)
            assertEquals(device.userId, api.request("/me").getString("user_id"))
            api.refreshDashboardOrigin()
            resultFile.writeText(JSONObject().put("user_id", device.userId).put("device_id", device.deviceId).put("recording_epoch", settings.epoch).put("passed", true).toString())
            // Leave the temporary linkage in place; consent must be enabled through the actual Account UI.
        } finally { codeFile.delete() }
    }
}
