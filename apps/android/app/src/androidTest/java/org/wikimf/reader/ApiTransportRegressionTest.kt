package org.wikimf.reader

import android.os.StrictMode
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class ApiTransportRegressionTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext.createDeviceProtectedStorageContext()
    @Test fun delayedAndChunkedBodiesAreMainSafeAndCancelable() = runBlocking {
        val settings = Settings(context)
        val originalApi = settings.apiUrl
        MockWebServer().use { server ->
            server.start()
            settings.apiUrl = server.url("/api/v1").toString()
            try {
                for (chunked in listOf(false, true)) {
                    val response = MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json")
                    if (chunked) response.setChunkedBody("{\"dashboard_url\":\"https://fixture.example\"}", 4) else response.setBody("{\"dashboard_url\":\"https://fixture.example\"}")
                    server.enqueue(response.setBodyDelay(1500, TimeUnit.MILLISECONDS))
                    withContext(Dispatchers.Main) {
                        val old = StrictMode.getThreadPolicy()
                        StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder(old).detectNetwork().penaltyDeathOnNetwork().build())
                        try {
                            val pending = async { Api(settings).request("/config", device = null) }
                            delay(200)
                            assertFalse("Main stays responsive before the delayed body arrives", pending.isCompleted)
                            assertEquals("https://fixture.example", pending.await().getString("dashboard_url"))
                        } finally { StrictMode.setThreadPolicy(old) }
                    }
                }
                server.enqueue(MockResponse().setBody("{\"pages\":[]}").setBodyDelay(5, TimeUnit.SECONDS))
                val http = OkHttpClient.Builder().addInterceptor { chain ->
                    chain.proceed(chain.request().newBuilder().url(server.url("/search")).build())
                }.build()
                withContext(Dispatchers.Main) {
                    val old = StrictMode.getThreadPolicy()
                    StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder(old).detectNetwork().penaltyDeathOnNetwork().build())
                    try {
                        var published = false
                        val search = launch { Api(settings, http).search("enwiki", "Earth", false); published = true }
                        delay(200); search.cancelAndJoin()
                        assertFalse("Canceled foreground search must not publish stale results", published)
                    } finally { StrictMode.setThreadPolicy(old) }
                }
                server.enqueue(MockResponse().setChunkedBody("{\"pages\":[{\"key\":\"Earth\",\"title\":\"Earth\",\"id\":9228}]}", 8).setBodyDelay(1500, TimeUnit.MILLISECONDS))
                withContext(Dispatchers.Main) {
                    val old = StrictMode.getThreadPolicy()
                    StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder(old).detectNetwork().penaltyDeathOnNetwork().build())
                    try { assertEquals("Earth", Api(settings, http).search("enwiki", "Earth", false).single().title) }
                    finally { StrictMode.setThreadPolicy(old) }
                }
            } finally { settings.unlink(); settings.apiUrl = originalApi }
        }
    }
}
