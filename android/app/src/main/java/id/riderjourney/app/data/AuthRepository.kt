package id.riderjourney.app.data

import id.riderjourney.app.data.api.LoginRequest
import id.riderjourney.app.data.api.MeDto
import id.riderjourney.app.data.api.RefreshRequest
import id.riderjourney.app.data.api.RegisterRequest
import id.riderjourney.app.data.api.ResetConfirmRequest
import id.riderjourney.app.data.api.ResetRequest
import id.riderjourney.app.data.api.RiderJourneyApi
import id.riderjourney.app.data.api.UpdateProfileRequest
import id.riderjourney.app.data.api.UpdateSettingsRequest
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: RiderJourneyApi,
    private val tokenStore: TokenStore,
    private val json: Json,
) {
    suspend fun register(email: String, username: String, displayName: String, password: String): Result<MeDto> =
        apiCall(json) {
            val response = api.register(RegisterRequest(email, username, displayName, password))
            tokenStore.save(response.accessToken, response.refreshToken)
            api.me()
        }

    suspend fun login(email: String, password: String): Result<MeDto> = apiCall(json) {
        val response = api.login(LoginRequest(email, password))
        tokenStore.save(response.accessToken, response.refreshToken)
        api.session()
    }

    suspend fun session(): Result<MeDto> = apiCall(json) { api.me() }

    suspend fun updateProfile(request: UpdateProfileRequest): Result<MeDto> = apiCall(json) { api.updateProfile(request) }

    suspend fun updateSettings(request: UpdateSettingsRequest): Result<MeDto> = apiCall(json) {
        api.updateSettings(request)
        api.me()
    }

    suspend fun requestPasswordReset(email: String): Result<Unit> = apiCall(json) {
        api.requestReset(ResetRequest(email))
    }

    suspend fun confirmPasswordReset(token: String, password: String): Result<Unit> = apiCall(json) {
        api.confirmReset(ResetConfirmRequest(token, password))
    }

    suspend fun logout(): Result<Unit> = apiCall(json) {
        val refresh = tokenStore.refreshToken()
        if (refresh != null) runCatching { api.logout(RefreshRequest(refresh)) }
        tokenStore.clear()
    }

    fun hasSession(): Boolean = tokenStore.accessToken() != null

    fun clearSession() = tokenStore.clear()
}
