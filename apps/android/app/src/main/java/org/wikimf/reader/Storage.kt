package org.wikimf.reader

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class LinkedDevice(val userId: String, val deviceId: String, val token: String, val displayName: String)

class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("preferences", Context.MODE_PRIVATE)
    var apiUrl: String
        get() = prefs.getString("api_url", BuildConfig.DEFAULT_API_URL)!!
        set(value) {
            val normalized = value.trimEnd('/')
            if (normalized != apiUrl) {
                // Clear credentials before publishing a different API destination.
                unlink()
                prefs.edit().putString("api_url", normalized).remove("dashboard_origin").apply()
            }
        }
    var dashboardOrigin: String?
        get() = DashboardUrls.base(apiUrl, prefs.getString("dashboard_origin", null), BuildConfig.DEBUG)
        set(value) { prefs.edit().putString("dashboard_origin", value).apply() }
    var localConsent: Boolean
        get() = prefs.getBoolean("local_consent", false)
        set(value) { prefs.edit().putBoolean("local_consent", value).apply() }
    var cloudConsent: Boolean
        get() = prefs.getBoolean("cloud_consent", false)
        set(value) { prefs.edit().putBoolean("cloud_consent", value).apply() }
    var paused: Boolean
        get() = prefs.getBoolean("paused", false)
        set(value) { prefs.edit().putBoolean("paused", value).apply() }
    var status: String
        get() = prefs.getString("sync_status", "未連携")!!
        set(value) { prefs.edit().putString("sync_status", value).apply() }
    var epoch: Int
        get() = prefs.getInt("epoch", 1)
        set(value) { prefs.edit().putInt("epoch", value).apply() }
    var serverEnabled: Boolean
        get() = prefs.getBoolean("server_enabled", true)
        set(value) { prefs.edit().putBoolean("server_enabled", value).apply() }
    var language: String
        get() = prefs.getString("language", if (java.util.Locale.getDefault().language == "ja") "jawiki" else "enwiki")!!
        set(value) { prefs.edit().putString("language", value).apply() }
    // Secrets never share a database/blob with observations or enter Wikipedia JS.
    private val secure = context.getSharedPreferences("encrypted_credentials", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("wikimf-token", null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder("wikimf-token", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
    }
    fun device(): LinkedDevice? = runCatching {
        val packed = secure.getString("device", null) ?: return null
        val bytes = Base64.decode(packed, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        val json = JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        LinkedDevice(json.getString("user_id"), json.getString("device_id"), json.getString("token"), json.getString("display_name"))
    }.getOrNull()
    fun saveDevice(device: LinkedDevice) {
        val json = JSONObject().put("user_id", device.userId).put("device_id", device.deviceId).put("token", device.token).put("display_name", device.displayName)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val packed = cipher.iv + cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
        secure.edit().putString("device", Base64.encodeToString(packed, Base64.NO_WRAP)).commit()
        cloudConsent = false
    }
    fun unlink() { secure.edit().clear().commit(); cloudConsent = false; status = "未連携" }
}

data class HistoryEntry(val wiki: String, val key: String, val title: String, val pageId: Long?, val url: String, val description: String? = null)
data class QueueRow(val id: String, val owner: String, val device: String, val payload: String, val pendingUrl: String?, val attempt: Int)

class LocalStore(context: Context) : SQLiteOpenHelper(context, "wikimf.sqlite", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE history(owner TEXT NOT NULL,kind TEXT NOT NULL,identity TEXT NOT NULL,wiki TEXT NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,page_id INTEGER,touched INTEGER NOT NULL,PRIMARY KEY(owner,kind,identity))")
        db.execSQL("CREATE TABLE outbox(id TEXT PRIMARY KEY,owner TEXT NOT NULL,device TEXT NOT NULL,payload TEXT NOT NULL,pending_url TEXT,created INTEGER NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0,error TEXT,quarantined INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE INDEX outbox_owner ON outbox(owner,device,next_try)")
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = Unit
    fun remember(owner: String, kind: String, hit: HistoryEntry) {
        val identity = hit.pageId?.let { "${hit.wiki}:$it" } ?: hit.url.substringBefore('#')
        writableDatabase.beginTransaction()
        try {
            val values = ContentValues().apply { put("owner", owner); put("kind", kind); put("identity", identity); put("wiki", hit.wiki); put("title", hit.title); put("url", hit.url); put("page_id", hit.pageId); put("touched", System.currentTimeMillis()) }
            writableDatabase.insertWithOnConflict("history", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            writableDatabase.execSQL("DELETE FROM history WHERE owner=? AND kind=? AND identity NOT IN (SELECT identity FROM history WHERE owner=? AND kind=? ORDER BY touched DESC LIMIT 20)", arrayOf(owner, kind, owner, kind))
            writableDatabase.setTransactionSuccessful()
        } finally { writableDatabase.endTransaction() }
    }
    fun history(owner: String, kind: String, wiki: String): List<HistoryEntry> = readableDatabase.rawQuery("SELECT wiki,title,url,page_id FROM history WHERE owner=? AND kind=? ORDER BY (wiki=?) DESC,touched DESC", arrayOf(owner, kind, wiki)).use { cursor ->
        buildList { while (cursor.moveToNext()) add(HistoryEntry(cursor.getString(0), "", cursor.getString(1), if (cursor.isNull(3)) null else cursor.getLong(3), cursor.getString(2))) }
    }
    fun clearHistory(owner: String) { writableDatabase.delete("history", "owner=?", arrayOf(owner)) }
    fun removeHistory(owner: String, url: String) { writableDatabase.delete("history", "owner=? AND url=?", arrayOf(owner, url)) }
    fun enqueue(device: LinkedDevice, event: JSONObject, pendingUrl: String?): Boolean {
        val json = event.toString()
        if (json.toByteArray().size > 65_536 || queueBytes() + json.toByteArray().size > 10 * 1024 * 1024) return false
        val values = ContentValues().apply { put("id", event.getString("event_id")); put("owner", device.userId); put("device", device.deviceId); put("payload", json); put("pending_url", pendingUrl); put("created", System.currentTimeMillis()) }
        return writableDatabase.insertWithOnConflict("outbox", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }
    fun queueBytes(): Long = readableDatabase.rawQuery("SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) FROM outbox", null).use { it.moveToFirst(); it.getLong(0) }
    fun count(owner: String): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM outbox WHERE owner=? AND quarantined=0", arrayOf(owner)).use { it.moveToFirst(); it.getInt(0) }
    fun quarantined(owner: String): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM outbox WHERE owner=? AND quarantined=1", arrayOf(owner)).use { it.moveToFirst(); it.getInt(0) }
    fun rows(device: LinkedDevice): List<QueueRow> = readableDatabase.rawQuery("SELECT id,owner,device,payload,pending_url,attempt FROM outbox WHERE owner=? AND device=? AND quarantined=0 AND next_try<=? ORDER BY created, rowid LIMIT 50", arrayOf(device.userId, device.deviceId, System.currentTimeMillis().toString())).use { cursor ->
        buildList { while (cursor.moveToNext()) add(QueueRow(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3), if (cursor.isNull(4)) null else cursor.getString(4), cursor.getInt(5))) }
    }
    fun finalizePending(id: String, event: JSONObject) { writableDatabase.update("outbox", ContentValues().apply { put("payload", event.toString()); putNull("pending_url") }, "id=? AND pending_url IS NOT NULL", arrayOf(id)) }
    fun ack(id: String) { writableDatabase.delete("outbox", "id=?", arrayOf(id)) }
    fun quarantine(id: String, reason: String) { writableDatabase.update("outbox", ContentValues().apply { put("quarantined", 1); put("error", reason) }, "id=?", arrayOf(id)) }
    fun retry(row: QueueRow, retryAfterMs: Long = 0) { writableDatabase.update("outbox", ContentValues().apply { put("attempt", row.attempt + 1); put("next_try", System.currentTimeMillis() + maxOf(retryAfterMs, SecurityPolicy.nextBackoff(row.attempt)) + kotlin.random.Random.nextLong(500)) }, "id=?", arrayOf(row.id)) }
    fun discard(owner: String) { writableDatabase.delete("outbox", "owner=?", arrayOf(owner)) }
    fun discardEpoch(owner: String, epoch: Int) {
        readableDatabase.rawQuery("SELECT id,payload FROM outbox WHERE owner=?", arrayOf(owner)).use { cursor ->
            while (cursor.moveToNext()) if (JSONObject(cursor.getString(1)).optInt("recording_epoch") != epoch) quarantine(cursor.getString(0), "recording_epoch_changed")
        }
    }
    fun expire() { writableDatabase.update("outbox", ContentValues().apply { put("quarantined", 1); put("error", "expired_7_days") }, "created<? AND quarantined=0", arrayOf((System.currentTimeMillis() - 7L * 86_400_000L).toString())) }
}
