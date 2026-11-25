package id.riderjourney.app.data.api

import id.riderjourney.app.data.TokenStore
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import id.riderjourney.app.BuildConfig

class TokenAuthenticator(
    private val tokenStore: TokenStore,
    private val json: Json,
) : Authenticator {
    private val lock = Any()
    private val refreshClient = OkHttpClient()

    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.request.url.encodedPath.contains("/v1/auth/")) return null
        val sentToken = response.request.header("Authorization")?.removePrefix("Bearer ")
        synchronized(lock) {
            val current = tokenStore.accessToken()
            if (current != null && current != sentToken) {
                return response.request.newBuilder().header("Authorization", "Bearer $current").build()
            }
            val refresh = tokenStore.refreshToken() ?: return null
            val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refresh))
                .toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url(BuildConfig.API_BASE_URL.trimEnd('/') + "/v1/auth/refresh")
                .post(body)
                .build()
            return try {
                refreshClient.newCall(request).execute().use { refreshed ->
                    if (!refreshed.isSuccessful) {
                        tokenStore.clear()
                        null
                    } else {
                        val payload = json.decodeFromString(RefreshResponse.serializer(), refreshed.body?.string().orEmpty())
                        tokenStore.save(payload.accessToken, payload.refreshToken)
                        response.request.newBuilder().header("Authorization", "Bearer ${payload.accessToken}").build()
                    }
                }
            } catch (_: Exception) {
                null
            }
        }
    }
}
