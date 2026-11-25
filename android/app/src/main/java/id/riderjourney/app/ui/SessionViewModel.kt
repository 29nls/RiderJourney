package id.riderjourney.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.riderjourney.app.data.AuthRepository
import id.riderjourney.app.data.api.MeDto
import id.riderjourney.app.data.api.UpdateProfileRequest
import id.riderjourney.app.data.api.UpdateSettingsRequest
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SessionUiState(
    val loading: Boolean = true,
    val session: MeDto? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

@HiltViewModel
class SessionViewModel @Inject constructor(private val auth: AuthRepository) : ViewModel() {
    var uiState by mutableStateOf(SessionUiState())
        private set

    init {
        if (!auth.hasSession()) {
            uiState = SessionUiState(loading = false)
        } else {
            refreshSession()
        }
    }

    fun refreshSession() {
        viewModelScope.launch {
            uiState = uiState.copy(loading = true, error = null)
            auth.session().fold(
                onSuccess = { uiState = SessionUiState(loading = false, session = it) },
                onFailure = { uiState = uiState.copy(loading = false, error = it.message) },
            )
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            auth.login(email.trim(), password).fold(
                onSuccess = { uiState = SessionUiState(loading = false, session = it) },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun register(email: String, username: String, displayName: String, password: String) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            auth.register(email.trim(), username.trim(), displayName.trim(), password).fold(
                onSuccess = { uiState = SessionUiState(loading = false, session = it) },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun requestReset(email: String) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            auth.requestPasswordReset(email.trim()).fold(
                onSuccess = {
                    uiState = uiState.copy(
                        busy = false,
                        notice = "Permintaan reset dibuat. Gunakan token dari email administrator untuk mengatur ulang kata sandi.",
                    )
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun confirmReset(token: String, newPassword: String) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            auth.confirmPasswordReset(token.trim(), newPassword).fold(
                onSuccess = { uiState = uiState.copy(busy = false, notice = "Kata sandi diperbarui. Silakan masuk.") },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun updateProfile(request: UpdateProfileRequest) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            auth.updateProfile(request).fold(
                onSuccess = { uiState = uiState.copy(busy = false, session = it, notice = "Profil disimpan.") },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun updateSettings(request: UpdateSettingsRequest) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            auth.updateSettings(request).fold(
                onSuccess = { uiState = uiState.copy(busy = false, session = it, notice = "Pengaturan disimpan.") },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun logout() {
        viewModelScope.launch {
            auth.logout()
            uiState = SessionUiState(loading = false)
        }
    }

    fun clearMessages() {
        uiState = uiState.copy(error = null, notice = null)
    }
}
