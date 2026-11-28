package id.riderjourney.app.e2e

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import id.riderjourney.app.BuildConfig
import id.riderjourney.app.data.AuthRepository
import id.riderjourney.app.data.MediaRepository
import id.riderjourney.app.data.TokenStore
import id.riderjourney.app.data.VehicleRepository
import id.riderjourney.app.data.api.MeDto
import id.riderjourney.app.data.api.RiderJourneyApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.UUID
import javax.inject.Named

/**
 * Shared wiring for the device E2E suite.
 *
 * The tests deliberately use the application's own Hilt graph and its real
 * Retrofit stack, pointed at the backend in `BuildConfig.API_BASE_URL`
 * (`http://10.0.2.2:3000` by default, which is the host loopback from inside the
 * emulator). Nothing here fakes a network response: a test only proves what the
 * device actually sent over HTTP and what the backend actually answered.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface E2eEntryPoint {
    fun authRepository(): AuthRepository
    fun mediaRepository(): MediaRepository
    fun vehicleRepository(): VehicleRepository
    fun tokenStore(): TokenStore
    fun api(): RiderJourneyApi

    @Named("storage")
    fun storageClient(): OkHttpClient
}

object E2e {
    const val PASSWORD = "RiderJourney-e2e-2026"

    val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    val graph: E2eEntryPoint by lazy {
        EntryPointAccessors.fromApplication(context.applicationContext, E2eEntryPoint::class.java)
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

    fun clearSession() = graph.tokenStore().clear()

    fun hasSession(): Boolean = graph.tokenStore().accessToken() != null

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
        val repo = graph.mediaRepository()
        val entity = repo.upload(uri, purpose, "image/png").getOrThrow()
        entity.mediaId ?: error("upload of $purpose returned no media id")
    }

    fun putObject(url: String, bytes: ByteArray): Int = block(60) {
        val request = Request.Builder()
            .url(url)
            .put(bytes.toRequestBody("image/png".toMediaType()))
            .build()
        graph.storageClient().newCall(request).execute().use { it.code }
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

    fun newRepository(): AuthRepository = AuthRepository(
        graph.api(),
        graph.tokenStore(),
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            coerceInputValues = true
        },
    )
}
