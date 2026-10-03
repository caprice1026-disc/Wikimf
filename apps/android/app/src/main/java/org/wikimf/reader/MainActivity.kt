package org.wikimf.reader

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.*
import org.json.JSONObject
import org.json.JSONTokener
import java.net.URI
import java.util.UUID

class MainActivity : ComponentActivity() {
    private lateinit var reader: ReaderController
    private var foreground by mutableStateOf(false)
    private var focused by mutableStateOf(false)
    private var savedWebView: Bundle? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        savedWebView = savedInstanceState?.getBundle("reader")
        setContent { MaterialTheme { App() } }
    }
    override fun onResume() { super.onResume(); foreground = true; if (::reader.isInitialized) { reader.webView?.onResume(); reader.activeChanged() }; SyncEngine.schedule(applicationContext) }
    override fun onPause() { foreground = false; if (::reader.isInitialized) { reader.activeChanged(); reader.webView?.onPause() }; super.onPause() }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); focused = hasFocus; if (::reader.isInitialized) reader.activeChanged() }
    override fun onSaveInstanceState(outState: Bundle) { if (::reader.isInitialized) reader.webView?.let { val state = Bundle(); it.saveState(state); outState.putBundle("reader", state) }; super.onSaveInstanceState(outState) }
    override fun onDestroy() { if (::reader.isInitialized) reader.destroy(); super.onDestroy() }

    @Composable private fun App() {
        val settings = remember { Settings(applicationContext) }
        val store = remember { LocalStore(applicationContext) }
        val scope = rememberCoroutineScope()
        var tab by rememberSaveable { mutableStateOf("reader") }
        var search by rememberSaveable { mutableStateOf(false) }
        var menu by remember { mutableStateOf(false) }
        var external by remember { mutableStateOf<String?>(null) }
        var actionDialog by remember { mutableStateOf<String?>(null) }
        var message by remember { mutableStateOf<String?>(null) }
        var tick by remember { mutableIntStateOf(0) }
        var renderGeneration by remember { mutableIntStateOf(0) }
        val device = remember(tick) { settings.device() }
        val owner = device?.userId ?: "guest"
        val dashboard = settings.dashboardOrigin
        LaunchedEffect(settings.apiUrl, foreground) { if (foreground) { Api(settings).refreshDashboardOrigin(); tick++ } }
        val controller = remember {
            ReaderController(this, settings, store, scope,
                active = { foreground && focused && tab == "reader" && !search && external == null && actionDialog == null && message == null && !menu },
                external = { external = it }, message = { message = it }, changed = { tick++ })
        }
        reader = controller
        LaunchedEffect(tab, search, external, actionDialog, menu, message, foreground, focused, tick) { controller.activeChanged() }
        BackHandler(search || tab == "account" || controller.canBack) {
            when { search -> search = false; tab == "account" -> tab = "reader"; controller.canBack -> controller.webView?.goBack() }
        }
        fun openBrowser(url: String) { controller.activeChanged(false); runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }.onFailure { message = "ブラウザを開けませんでした" } }
        fun openArticle(hit: HistoryEntry, searched: Boolean) {
            if (searched && settings.localConsent) store.remember(owner, "searched", hit)
            search = false; tab = "reader"; controller.webView?.loadUrl(hit.url)
        }
        Scaffold(bottomBar = {
            NavigationBar {
                NavigationBarItem(selected = tab == "reader", onClick = { tab = "reader"; search = false }, icon = { Text("▤") }, label = { Text("Reader") })
                NavigationBarItem(selected = tab == "account", onClick = { tab = "account"; search = false }, icon = { Text("●") }, label = { Text("Account") })
            }
        }) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                if (tab == "reader" && !search) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(enabled = controller.canBack, onClick = { controller.webView?.goBack() }) { Text("← 戻る") }
                    TextButton(enabled = controller.canForward, onClick = { controller.webView?.goForward() }) { Text("進む →") }
                    TextButton(onClick = { settings.language = UrlPolicy.wiki(controller.url) ?: settings.language; search = true }) { Text("検索") }
                    Box {
                        TextButton(onClick = { menu = true }) { Text("メニュー") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("再読み込み") }, onClick = { menu = false; if (controller.crashed) { renderGeneration++; controller.crashed = false } else controller.webView?.reload() })
                            DropdownMenuItem(text = { Text("ブラウザで開く") }, onClick = { menu = false; external = controller.url })
                            DropdownMenuItem(text = { Text("URLを共有") }, onClick = { menu = false; startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, controller.url), "URLを共有")) })
                            DropdownMenuItem(text = { Text("記事の状態・削除") }, enabled = dashboard != null, onClick = { menu = false; dashboard?.let { openBrowser(DashboardUrls.article(it, controller.articleId)) } })
                            DropdownMenuItem(text = { Text(if (settings.paused) "記録を再開" else "記録を一時停止") }, onClick = { menu = false; settings.paused = !settings.paused; tick++ })
                        }
                    }
                }
                if (tab == "reader" && !search && controller.status.isNotBlank()) Text(controller.status, Modifier.padding(horizontal = 12.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall)
                if (tab == "reader" && !search && controller.stateLabel.isNotBlank()) Text(controller.stateLabel, Modifier.padding(horizontal = 12.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall)
                Box(Modifier.weight(1f)) {
                    key(renderGeneration) {
                        AndroidView(factory = { controller.create(savedWebView.also { savedWebView = null }) }, update = { it.visibility = if (tab == "reader" && !search) View.VISIBLE else View.INVISIBLE }, modifier = Modifier.fillMaxSize())
                    }
                    if (search) SearchScreen(settings, store, owner, scope, onClose = { search = false }, onChoose = { openArticle(it, true) }, onExternal = { external = it })
                    else if (tab == "account") AccountScreen(applicationContext, settings, store, device, scope, openBrowser = ::openBrowser, changed = { tick++ }, logout = { actionDialog = "logout" })
                    else if (controller.crashed) TextButton(onClick = { controller.crashed = false; renderGeneration++ }) { Text("Readerの描画が停止しました。再読み込み") }
                }
            }
        }
        external?.let { url ->
            AlertDialog(onDismissRequest = { external = null }, title = { Text("ブラウザで開く") }, text = { Text(runCatching { URI(url).host }.getOrNull() ?: "不正なURL") }, confirmButton = { TextButton(onClick = { external = null; if (UrlPolicy.classify(url) != UrlPolicy.Destination.REJECT) openBrowser(url) }) { Text("開く") } }, dismissButton = { TextButton(onClick = { external = null }) { Text("キャンセル") } })
        }
        if (actionDialog == "logout") AlertDialog(onDismissRequest = { actionDialog = null }, title = { Text("端末連携を解除") }, text = { Text("未送信 ${store.count(owner)}件。クラウドの端末失効はDashboardで管理できます。") }, confirmButton = {
            TextButton(onClick = { scope.launch { val success = SyncEngine(applicationContext).sync(); tick++; if (success && store.count(owner) == 0) { controller.stop("logout"); settings.unlink(); actionDialog = null; tick++ } else message = "未送信の記録があります。再試行するか破棄してください" } }) { Text("同期して解除") }
        }, dismissButton = { TextButton(onClick = { controller.stop("logout"); store.discard(owner); settings.unlink(); actionDialog = null; tick++ }) { Text("未送信を破棄して解除") } })
        message?.let { value -> AlertDialog(onDismissRequest = { message = null }, title = { Text("wikimf") }, text = { Text(value) }, confirmButton = { TextButton(onClick = { message = null }) { Text("閉じる") } }) }
        DisposableEffect(Unit) { onDispose { store.close() } }
    }
}

@Composable private fun SearchScreen(
    settings: Settings, store: LocalStore, owner: String, scope: CoroutineScope,
    onClose: () -> Unit, onChoose: (HistoryEntry) -> Unit, onExternal: (String) -> Unit
) {
    var input by remember { mutableStateOf(TextFieldValue("")) }
    var language by remember { mutableStateOf(settings.language) }
    var full by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var hits by remember { mutableStateOf(emptyList<HistoryEntry>()) }
    var historyGeneration by remember { mutableIntStateOf(0) }
    val gate = remember { SearchGate() }
    var requestJob by remember { mutableStateOf<Job?>(null) }
    fun request(immediate: Boolean = false) {
        requestJob?.cancel()
        val request = gate.next(language, input.text, full)
        if (input.composition != null || request.query.isEmpty()) { gate.cancel(); loading = false; error = null; hits = emptyList(); return }
        requestJob = scope.launch {
            if (!immediate) delay(300)
            if (!gate.current(request)) return@launch
            loading = true; error = null
            try {
                val result = Api(settings).search(request.language, request.query, request.full)
                if (gate.current(request)) { hits = result; loading = false }
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                if (gate.current(request)) { error = if (failure is ApiFailure && failure.code == 429) "検索が一時的に制限されています。再試行すると待ち時間後に検索します" else if (failure is ApiFailure) "Wikipedia検索エラー (${failure.code})" else "オフラインまたは通信エラー"; loading = false; hits = emptyList() }
            }
        }
    }
    LaunchedEffect(input, language) { request() }
    DisposableEffect(Unit) { onDispose { requestJob?.cancel(); gate.cancel() } }
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.padding(12.dp)) {
            Row {
                TextButton(onClick = onClose) { Text("←") }
                OutlinedTextField(value = input, onValueChange = { input = it; full = false }, label = { Text("Wikipediaを検索") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { full = true; request(true) }), modifier = Modifier.weight(1f),
                    trailingIcon = { TextButton(onClick = { input = TextFieldValue(""); gate.cancel(); requestJob?.cancel(); hits = emptyList(); error = null; loading = false }) { Text("×") } })
            }
            Row { listOf("jawiki" to "日本語", "enwiki" to "English").forEach { (wiki, name) -> FilterChip(selected = language == wiki, onClick = { language = wiki; settings.language = wiki }, label = { Text(name) }, modifier = Modifier.padding(end = 8.dp)) } }
            if (input.text.isBlank()) {
                val viewed = remember(owner, language, historyGeneration) { store.history(owner, "viewed", language) }
                val searched = remember(owner, language, historyGeneration) { store.history(owner, "searched", language) }
                if (!settings.localConsent) Text("最近の記事を端末へ保存するにはAccountで同意してください。入力語は保存しません。", style = MaterialTheme.typography.bodySmall)
                LazyColumn {
                    listOf("最近見た記事" to viewed, "最近検索した記事" to searched).forEach { (label, entries) ->
                        item { Text(label, Modifier.padding(vertical = 12.dp), style = MaterialTheme.typography.titleMedium) }
                        if (entries.isEmpty()) item { Text("記事はありません") }
                        items(entries) { hit -> Row { TextButton(onClick = { onChoose(hit) }, modifier = Modifier.weight(1f)) { Text(hit.title) }; TextButton(onClick = { store.removeHistory(owner, hit.url); historyGeneration++ }) { Text("削除") } } }
                    }
                }
            } else {
                Text(if (full) "本文を含む検索結果" else "タイトル候補", Modifier.padding(vertical = 8.dp), style = MaterialTheme.typography.titleMedium)
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (error != null) { Text(error!!); TextButton(onClick = { request(true) }) { Text("再試行") }; TextButton(onClick = { onExternal("https://${if (language == "jawiki") "ja" else "en"}.wikipedia.org/w/index.php?search=" + java.net.URLEncoder.encode(input.text.trim(), "UTF-8")) }) { Text("Wikipedia本家の検索を開く") } }
                else if (!loading && hits.isEmpty() && input.composition == null) Text("結果はありません")
                LazyColumn(Modifier.weight(1f)) {
                    items(hits) { hit -> TextButton(onClick = { onChoose(hit) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Column(Modifier.fillMaxWidth()) { Text(hit.title); hit.description?.let { Text(it, maxLines = 2, style = MaterialTheme.typography.bodySmall) } } } }
                    if (!full) item { TextButton(onClick = { full = true; request(true) }, modifier = Modifier.fillMaxWidth()) { Text("「${input.text.trim()}」で本文も検索する") } }
                }
            }
        }
    }
}

@Composable private fun AccountScreen(
    context: android.content.Context, settings: Settings, store: LocalStore, device: LinkedDevice?, scope: CoroutineScope,
    openBrowser: (String) -> Unit, changed: () -> Unit, logout: () -> Unit
) {
    var localConsent by remember { mutableStateOf(settings.localConsent) }
    var cloudConsent by remember(device?.userId) { mutableStateOf(settings.cloudConsent) }
    var paused by remember { mutableStateOf(settings.paused) }
    var apiUrl by remember { mutableStateOf(settings.apiUrl) }
    var pairing by remember { mutableStateOf<JSONObject?>(null) }
    var pairingStatus by remember { mutableStateOf<String?>(null) }
    var stats by remember(device?.userId) { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(device?.deviceId) {
        if (device != null) {
            stats = runCatching { Api(settings).request("/me/stats") }.getOrNull()
        }
    }
    fun perform(block: suspend () -> Unit) { scope.launch { busy = true; try { block() } catch (failure: Exception) { if (failure is CancellationException) throw failure; pairingStatus = if (failure is ApiFailure && failure.errorCode == "authorization_pending") "Webで承認してから、もう一度確認してください" else "通信または認証に失敗しました。設定を確認してください" } finally { busy = false; changed() } } }
    Surface(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { Text("Account", style = MaterialTheme.typography.headlineMedium) }
            item { Text(device?.displayName ?: "未連携・ゲスト") }
            if (device == null) {
                item { Text("読む・検索する操作は連携なしで使えます。GoogleまたはGitHubでWebへログインし、この端末を明示的に承認してください。") }
                item { OutlinedTextField(apiUrl, { apiUrl = it }, label = { Text("wikimf API URL (HTTPS /api/v1)") }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
                item { Button(enabled = !busy, onClick = {
                    runCatching { require(Api.validBase(apiUrl)); settings.apiUrl = apiUrl }.onSuccess {
                        perform { val api = Api(settings); api.refreshDashboardOrigin(); pairing = api.request("/device-links", JSONObject().put("source", "android_reader").put("display_name", "Android Reader"), null); pairingStatus = null }
                    }.onFailure { pairingStatus = "HTTPSのAPI URLを指定してください" }
                }) { Text("Google / GitHubで端末連携") } }
                pairing?.let { grant ->
                    item { Text("確認コード: ${grant.getString("user_code")}\n有効期限: ${grant.getString("expires_at")}") }
                    item { Button(onClick = { val target = settings.dashboardOrigin?.let { DashboardUrls.pairing(settings.apiUrl, it, grant.getString("verification_url"), grant.getString("link_id"), BuildConfig.DEBUG) }; if (target != null) openBrowser(target) else pairingStatus = "安全な管理画面の連携URLを確認できません" }) { Text("Webでログイン・承認") } }
                    item { Button(enabled = !busy, onClick = { perform {
                        val result = Api(settings).request("/device-links/${grant.getString("link_id")}/exchange", JSONObject().put("device_secret", grant.getString("device_secret")), null)
                        settings.saveDevice(LinkedDevice(result.getString("user_id"), result.getString("device_id"), result.getString("token"), result.getString("display_name")))
                        settings.epoch = result.getInt("recording_epoch"); SyncEngine.schedule(context); pairing = null; pairingStatus = "連携済み。クラウド記録の同意を選んでください"; changed()
                    } }) { Text("連携を確認") } }
                }
            }
            stats?.let { value ->
                val library = value.getJSONObject("library")
                val activity = value.getJSONObject("activity")
                item { Text("自動閲覧記事数 ${library.getLong("qualified_article_count")}\n読了記事数 ${library.getJSONObject("state_counts").getLong("completed")}\nアクティブ時間 ${activity.getLong("active_ms") / 60_000}分\n推定読書文字数 ${activity.getLong("estimated_unique_read_chars")}") }
            }
            item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("端末内の記事履歴を保存", Modifier.weight(1f)); Switch(checked = localConsent, onCheckedChange = { localConsent = it; settings.localConsent = it; changed() }) } }
            item { Text("最近見た記事と検索結果から開いた記事を保存します。入力語は保存しません。検索語はWikipediaへ送られます。", style = MaterialTheme.typography.bodySmall) }
            item { TextButton(onClick = { store.clearHistory(device?.userId ?: "guest"); changed() }) { Text("端末内の記事履歴をすべて消去") } }
            if (device != null) {
                item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("クラウド読書記録に同意", Modifier.weight(1f)); Switch(checked = cloudConsent, onCheckedChange = { cloudConsent = it; settings.cloudConsent = it; SyncEngine.schedule(context); changed() }) } }
                item { Text("記事・時間・本文カバー率を非公開で同期します。Dashboardの収集許可も必要です。本文・入力語・Cookie・認証情報は計測イベントへ含めません。", style = MaterialTheme.typography.bodySmall) }
                item { Row { Text("この端末で記録を一時停止", Modifier.weight(1f)); Switch(checked = paused, onCheckedChange = { paused = it; settings.paused = it; changed() }) } }
                item { Text(settings.status + "\n未送信 ${store.count(device.userId)}件・隔離 ${store.quarantined(device.userId)}件") }
                item { TextButton(onClick = { SyncEngine.schedule(context); changed() }) { Text("同期を再試行") } }
                item { TextButton(onClick = logout) { Text("ログアウト / 端末連携解除") } }
            }
            pairingStatus?.let { item { Text(it) } }
            if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            item { Button(enabled = settings.dashboardOrigin != null, onClick = { settings.dashboardOrigin?.let { openBrowser(DashboardUrls.overview(it)) } }) { Text("Dashboardを開く") } }
            item { TextButton(enabled = settings.dashboardOrigin != null, onClick = { settings.dashboardOrigin?.let { openBrowser(DashboardUrls.privacy(it)) } }) { Text("全端末の記録停止・削除・export・公開設定") } }
        }
    }
}

private class ReaderController(
    private val activity: MainActivity, private val settings: Settings, private val store: LocalStore,
    private val scope: CoroutineScope, private val active: () -> Boolean,
    private val external: (String) -> Unit, private val message: (String) -> Unit, private val changed: () -> Unit
) {
    var webView: WebView? = null
    var canBack by mutableStateOf(false)
    var canForward by mutableStateOf(false)
    var status by mutableStateOf("")
    var stateLabel by mutableStateOf("")
    var crashed by mutableStateOf(false)
    var url: String = ""
    var articleId: String? = null
    private var article: JSONObject? = null
    private val guard = BridgeGuard()
    private var bridgeEnabled = false
    private var contextStarted = false
    private var hostActive = false
    private var sessionDevice: LinkedDevice? = null
    private var sessionEpoch = 0
    private var pageReady = false
    private var domEligible = false
    private var domPageId = 0L
    private var pageGeneration = 0
    private var resolveJob: Job? = null
    private fun route(url: String, gesture: Boolean): Boolean = when (UrlPolicy.classify(url)) {
        UrlPolicy.Destination.READER -> false
        UrlPolicy.Destination.EXTERNAL -> { if (gesture) external(url); true }
        UrlPolicy.Destination.REJECT -> { if (gesture) message("この種類のリンクは開けません"); true }
    }
    @SuppressLint("SetJavaScriptEnabled")
    fun create(state: Bundle?): WebView {
        return WebView(activity).apply {
            webView = this
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportMultipleWindows(true)
            settings.javaScriptCanOpenWindowsAutomatically = false
            isFocusable = true
            isFocusableInTouchMode = true
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            bridgeEnabled = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(this, "WikimfObservation", UrlPolicy.origins) { view, msg, origin, mainFrame, _ ->
                val payload = msg.data ?: return@addWebMessageListener
                if (!SecurityPolicy.acceptsBridge(origin.toString(), mainFrame, payload.toByteArray().size, view.url ?: "")) return@addWebMessageListener
                val event = runCatching { JSONObject(payload) }.getOrNull() ?: return@addWebMessageListener
                if (event.optString("kind") == "document_changed") { if (active()) { stop("document_changed"); start() }; return@addWebMessageListener }
                val device = sessionDevice ?: return@addWebMessageListener
                if (!contextStarted || !guard.accepts(event, System.currentTimeMillis())) return@addWebMessageListener
                event.put("source", "android_reader").put("device_id", device.deviceId).put("recording_epoch", sessionEpoch)
                val currentArticle = article
                if (currentArticle != null) event.put("article_id", currentArticle.getString("article_id")).put("wiki", currentArticle.getString("wiki")).put("page_id", currentArticle.getLong("page_id"))
                val accepted = store.enqueue(device, event, if (currentArticle == null) this@ReaderController.url.substringBefore('#') else null)
                if (!accepted) { this@ReaderController.settings.paused = true; status = "未送信キュー上限に達したため記録を停止しました"; activeChanged(false) }
                else SyncEngine.schedule(activity.applicationContext)
                if (event.getString("type") != "session.opened" && currentArticle != null) refreshState()
                changed()
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = if (request.isForMainFrame) route(request.url.toString(), request.hasGesture()) else false
                override fun onPageStarted(view: WebView, nextUrl: String?, favicon: Bitmap?) { stop("navigate"); pageReady = false; domEligible = false; domPageId = 0; resolveJob?.cancel(); pageGeneration++; article = null; articleId = null; stateLabel = ""; this@ReaderController.url = nextUrl ?: ""; history(view) }
                override fun onPageFinished(view: WebView, nextUrl: String?) {
                    this@ReaderController.url = nextUrl ?: ""; history(view)
                    if (UrlPolicy.classify(this@ReaderController.url) != UrlPolicy.Destination.READER) { stop("navigate"); view.stopLoading(); return }
                    pageReady = true
                    val generation = pageGeneration
                    view.evaluateJavascript("JSON.stringify({id:window.mw?.config?.get('wgArticleId')||0,ns:window.mw?.config?.get('wgNamespaceNumber'),title:window.mw?.config?.get('wgTitle')||document.title,disambiguation:!!document.querySelector('.disambig, #disambigbox')})") { raw ->
                        val metadata = runCatching { JSONObject(JSONTokener(raw).nextValue() as String) }.getOrNull() ?: return@evaluateJavascript
                        if (generation != pageGeneration || metadata.optInt("ns", -1) != 0 || metadata.optBoolean("disambiguation") || !UrlPolicy.measurable(this@ReaderController.url)) return@evaluateJavascript
                        domEligible = true; domPageId = metadata.optLong("id")
                        if (this@ReaderController.settings.localConsent) store.remember(this@ReaderController.settings.device()?.userId ?: "guest", "viewed", HistoryEntry(UrlPolicy.wiki(this@ReaderController.url)!!, "", metadata.getString("title"), metadata.optLong("id").takeIf { it > 0 }, this@ReaderController.url))
                        resolveJob = scope.launch {
                            article = runCatching { Api(this@ReaderController.settings).request("/articles/resolve", JSONObject().put("url", this@ReaderController.url)) }.getOrNull()
                            if (generation != pageGeneration) return@launch
                            articleId = article?.optString("article_id")
                            refreshState()
                            if (article?.optBoolean("trackable") == false) { status = "このページは読書計測の対象外です"; return@launch }
                            if (article == null) articleId = null
                            start(metadata.optLong("id"))
                        }
                    }
                    if (!bridgeEnabled) status = "このWebViewは安全な計測接続に対応していません。Readerは利用できます"
                }
                override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) { history(view) }
                override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) { handler.cancel(); status = "安全な接続を確認できませんでした" }
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { stop("pause"); crashed = true; view.destroy(); webView = null; changed(); return true }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, result: android.os.Message): Boolean {
                    if (!isUserGesture) return false
                    val child = WebView(activity)
                    child.webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(temp: WebView, request: WebResourceRequest): Boolean { val target = request.url.toString(); if (UrlPolicy.classify(target) == UrlPolicy.Destination.READER) view.loadUrl(target) else route(target, true); temp.destroy(); return true }
                    }
                    (result.obj as WebView.WebViewTransport).webView = child; result.sendToTarget(); return true
                }
            }
            if (state == null || restoreState(state) == null) loadUrl(if (this@ReaderController.settings.language == "jawiki") "https://ja.wikipedia.org/wiki/メインページ" else "https://en.wikipedia.org/wiki/Main_Page")
        }
    }
    private fun history(view: WebView) { canBack = view.canGoBack(); canForward = view.canGoForward(); changed() }
    private fun refreshState() {
        val id = articleId ?: return
        val owner = settings.device()?.userId ?: return
        val generation = pageGeneration
        scope.launch {
            val record = runCatching { Api(settings).request("/me/articles/$id") }.getOrNull() ?: return@launch
            if (generation != pageGeneration || settings.device()?.userId != owner) return@launch
            val state = when (record.getString("effective_state")) { "completed" -> "読了"; "partial" -> "途中まで読んだ"; else -> "閲覧" }
            val evidence = if (record.optString("evidence") == "self_reported") "自己申告" else "推定"
            stateLabel = "$state ($evidence)"
        }
    }
    fun activeChanged(force: Boolean? = null) {
        if (contextStarted && (settings.device()?.deviceId != sessionDevice?.deviceId || settings.epoch != sessionEpoch)) { stop("logout"); stateLabel = "" }
        val enabled = (force ?: active()) && settings.cloudConsent && settings.serverEnabled && !settings.paused && settings.device() != null
        if (!enabled && hostActive) { hostActive = false; webView?.evaluateJavascript("window.WKMF_NATIVE?.setActive(false)", null) }
        else if (enabled && contextStarted && !hostActive) { hostActive = true; webView?.requestFocus(); webView?.evaluateJavascript("window.WKMF_NATIVE?.setActive(true)", null) }
        else if (enabled && pageReady && domEligible && article?.optBoolean("trackable") != false) start(domPageId)
        if (bridgeEnabled && !enabled) status = if (settings.paused) "記録一時停止中" else if (!settings.cloudConsent || settings.device() == null) "クラウド記録はAccountで連携・同意後に開始します" else if (!settings.serverEnabled) "クラウド収集はDashboardで有効にしてください" else ""
    }
    private fun start(fallbackPageId: Long = domPageId) {
        if (contextStarted || !pageReady || !bridgeEnabled || !active() || !settings.cloudConsent || !settings.serverEnabled || settings.paused || !UrlPolicy.measurable(url)) return
        val device = settings.device() ?: return
        sessionDevice = device
        sessionEpoch = settings.epoch
        val session = guard.reset()
        val descriptor = article ?: JSONObject().put("article_id", JSONObject.NULL).put("wiki", UrlPolicy.wiki(url)).put("page_id", fallbackPageId)
        val context = JSONObject().put("article", descriptor).put("deviceId", device.deviceId).put("source", "android_reader").put("epoch", settings.epoch).put("sessionId", session).put("active", true)
        val bundle = runCatching { activity.assets.open("android-tracker.js").bufferedReader().use { it.readText() } }.getOrElse { status = "同梱trackerがありません。計測停止中"; return }
        contextStarted = true
        hostActive = true
        webView?.requestFocus()
        webView?.evaluateJavascript("window.WKMF_CONTEXT=$context;\n$bundle", null)
        status = ""
    }
    fun stop(reason: String) { webView?.evaluateJavascript("window.WKMF_NATIVE?.stop(${JSONObject.quote(reason)})", null); contextStarted = false; hostActive = false }
    fun destroy() { stop("pause"); resolveJob?.cancel(); webView?.destroy(); webView = null }
}
