plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }

val releaseSigning = listOf("WIKIMF_SIGNING_KEYSTORE", "WIKIMF_SIGNING_STORE_PASSWORD", "WIKIMF_SIGNING_KEY_ALIAS", "WIKIMF_SIGNING_KEY_PASSWORD")
    .associateWith { providers.environmentVariable(it).orNull?.takeIf(String::isNotBlank) }
check(releaseSigning.values.all { it == null } || releaseSigning.values.all { it != null }) {
    "Release signing requires all four WIKIMF_SIGNING_* environment variables."
}

android {
    namespace = "org.wikimf.reader"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    signingConfigs.getByName("debug") { storeFile = rootProject.file(".tooling/debug.keystore") }
    if (releaseSigning.values.all { it != null }) {
        signingConfigs.create("release") {
            storeFile = rootProject.file(releaseSigning.getValue("WIKIMF_SIGNING_KEYSTORE")!!)
            storeType = "PKCS12"
            storePassword = releaseSigning.getValue("WIKIMF_SIGNING_STORE_PASSWORD")
            keyAlias = releaseSigning.getValue("WIKIMF_SIGNING_KEY_ALIAS")
            keyPassword = releaseSigning.getValue("WIKIMF_SIGNING_KEY_PASSWORD")
        }
    }
    buildTypes.getByName("release") {
        isDebuggable = false
        signingConfig = signingConfigs.findByName("release")
    }
    defaultConfig {
        applicationId = "org.wikimf.reader"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "DEFAULT_API_URL", "\"https://wikimf.example/api/v1\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("trackerAssets"))
}

val bundleTracker by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir.resolve("../.."))
    commandLine("node", "packages/tracker/build.js")
}
val copyTracker by tasks.registering(Copy::class) {
    dependsOn(bundleTracker)
    from(rootProject.projectDir.resolve("../../packages/tracker/dist/android-tracker.js"))
    into(layout.buildDirectory.dir("trackerAssets"))
}
tasks.named("preBuild").configure { dependsOn(copyTracker) }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
