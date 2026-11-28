package id.riderjourney.app.e2e

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import id.riderjourney.app.BuildConfig
import id.riderjourney.app.data.AuthRepository
import id.riderjourney.app.data.MediaRepository
import id.riderjourney.app.data.MediaUploadRequest
import id.riderjourney.app.data.TokenStore
import id.riderjourney.app.data.VehicleRepository
import id.riderjourney.app.data.api.MeDto
import id.riderjourney.app.data.api.RiderJourneyApi
import id.riderjourney.app.data.api.TokenAuthenticator
import id.riderjourney.app.data.local.MIGRATION_1_2
import id.riderjourney.app.data.local.TripDatabase
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Shared wiring for the device E2E suite.
 *
 * The tests use the app's own repositories, Retrofit interface, TokenStore and
 * Room database, pointed at the backend in `BuildConfig.API_BASE_URL`
 * (`http://10.0.2.2:3000`, the host loopback from inside the emulator).
 *
 * The graph is assembled here instead of through a Hilt `@EntryPoint`: an
 * entry point declared in androidTest is only implemented in the component that
 * hilt-android-testing generates, so casting the real app component to it fails
 * with ClassCastException on a device. Constructing the same singletons with
 * their public constructors keeps the suite free of a new dependency and of a
 * custom instrumentation runner.
 */
object E2e {
    const val PASSWORD = "RiderJourney-e2e-2026"

    val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    val tokens: TokenStore by lazy { TokenStore(context) }

    private val apiClient: OkHttpClient by lazy {
        val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val token = tokens.accessToken()
                val request = if (token != null) {
                    chain.request().newBuilder().header("Authorization", "Bearer $token").build()
                } else {
                    chain.request()
                }
                chain.proceed(request)
            }
            .addInterceptor(logging)
            .authenticator(TokenAuthenticator(tokens, json))
            .build()
    }

    val api: RiderJourneyApi by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL.trimEnd('/') + "/")
            .client(apiClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(RiderJourneyApi::class.java)
    }

    /** Bare client for presigned S3 PUT/GET: no Authorization, no TokenAuthenticator. */
    private val storageClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    private val database: TripDatabase by lazy {
        Room.databaseBuilder(context, TripDatabase::class.java, "riderjourney-trips.db")
            .addMigrations(MIGRATION_1_2)
            .build()
    }

    val auth: AuthRepository by lazy { AuthRepository(api, tokens, json) }
    val media: MediaRepository by lazy { MediaRepository(context, api, storageClient, database.mediaUploadDao()) }
    val vehicles: VehicleRepository by lazy { VehicleRepository(api, json) }

    /** Keeps the call sites reading like the old entry point accessor. */
    interface E2eGraph {
        fun authRepository(): AuthRepository
        fun mediaRepository(): MediaRepository
        fun vehicleRepository(): VehicleRepository
        fun tokenStore(): TokenStore
        fun api(): RiderJourneyApi
    }

    val graph: E2eGraph = object : E2eGraph {
        override fun authRepository(): AuthRepository = auth
        override fun mediaRepository(): MediaRepository = media
        override fun vehicleRepository(): VehicleRepository = vehicles
        override fun tokenStore(): TokenStore = tokens
        override fun api(): RiderJourneyApi = E2e.api
    }

    fun <T> block(seconds: Long = 90, body: suspend () -> T): T =
        runBlocking { withTimeout(seconds * 1000) { body() } }

    fun freshEmail(prefix: String): String =
        "$prefix.${System.currentTimeMillis()}.${UUID.randomUUID().toString().take(8)}@e2e.riderjourney.test"

    /** A real account on the real backend; tokens land in the app's TokenStore. */
    fun registerAccount(prefix: String): MeDto = block {
        val repo = graph.authRepository()
        repo.clearSession()
        val email = freshEmail(prefix)
        // Usernames are lowercase alphanumeric with dots/underscores only, so the
        // email local part (which carries a hyphenated prefix) cannot be reused.
        val username = "e2e" + UUID.randomUUID().toString().replace("-", "").take(12)
        repo.register(email, username, "E2E $prefix", PASSWORD).getOrThrow()
    }

    fun clearSession() = tokens.clear()

    fun hasSession(): Boolean = tokens.accessToken() != null

    /** 64x64 PNG on disk; uploads read it through the app's own file path. */
    fun pngFixture(name: String, color: Int = Color.rgb(20, 120, 200)): Uri {
        val file = File(context.cacheDir, "$name-${UUID.randomUUID()}.png")
        val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(color)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        return Uri.fromFile(file)
    }

    fun upload(uri: Uri, purpose: String): String = block(120) {
        val entity = graph.mediaRepository().upload(uri, purpose, "image/png").getOrThrow()
        entity.mediaId ?: error("upload of $purpose returned no media id")
    }

    /** Presigned PUT signs Content-Type and If-None-Match, so both must be sent. */
    fun putObject(url: String, bytes: ByteArray): Int = block(60) {
        val request = MediaUploadRequest.build(
            url,
            "image/png",
            bytes.toRequestBody("image/png".toMediaType()),
        )
        storageClient.newCall(request).execute().use { it.code }
    }

    fun signUrlParts(mediaId: String): Pair<String, String> = block {
        val url = graph.api().getSignedUrl(mediaId).url ?: error("no signed url for $mediaId")
        val uri = Uri.parse(url)
        val expires = uri.getQueryParameter("expires") ?: error("signed url without expires")
        val signature = uri.getQueryParameter("signature") ?: error("signed url without signature")
        expires to signature
    }

    /** The backend scans asynchronously; the owner can still read their own media. */
    fun awaitAvatar(mediaId: String, seconds: Long = 60): MeDto = block(seconds + 10) {
        val repo = graph.authRepository()
        val deadline = System.currentTimeMillis() + seconds * 1000
        var last: MeDto? = null
        while (System.currentTimeMillis() < deadline) {
            last = repo.session().getOrThrow()
            if (last.avatarMediaId == mediaId) return@block last
            Thread.sleep(1000)
        }
        error("avatar never pointed at $mediaId; last=${last?.avatarMediaId}")
    }

    fun backendUrl(): String = BuildConfig.API_BASE_URL

    fun newRepository(): AuthRepository = AuthRepository(graph.api(), graph.tokenStore(), json)
}
