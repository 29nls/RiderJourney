package id.riderjourney.app.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import id.riderjourney.app.data.TripRepository
import id.riderjourney.app.data.VehicleRepository
import id.riderjourney.app.data.api.TripDto
import id.riderjourney.app.location.TripTrackingService
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TripUiState(
    val active: TripDto? = null,
    val history: List<TripDto> = emptyList(),
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

@HiltViewModel
class TripViewModel @Inject constructor(
    private val trips: TripRepository,
    private val vehicles: VehicleRepository,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    var uiState by mutableStateOf(TripUiState())
        private set

    fun refresh() {
        viewModelScope.launch {
            uiState = uiState.copy(loading = true, error = null)
            val activeResult = trips.active()
            val historyResult = trips.history()
            val active = activeResult.getOrNull()
            uiState = uiState.copy(
                loading = false,
                active = active,
                history = historyResult.getOrDefault(uiState.history),
                error = activeResult.exceptionOrNull()?.message ?: historyResult.exceptionOrNull()?.message,
            )
            if (active != null && active.status == "active") {
                startTrackingIfPermitted(active.id)
            } else if (activeResult.isSuccess) {
                TripTrackingService.stop(context)
            }
        }
    }

    fun start() {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            val list = vehicles.list().getOrNull().orEmpty()
            val primary = list.firstOrNull { it.isPrimary } ?: list.firstOrNull()
            trips.start(primary?.id).fold(
                onSuccess = { trip ->
                    uiState = uiState.copy(busy = false, active = trip, notice = "Perjalanan dimulai.")
                    startTrackingIfPermitted(trip.id)
                    loadHistory()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun pause() {
        val id = uiState.active?.id ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            trips.pause(id).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, active = it, notice = "Perjalanan dijeda.")
                    TripTrackingService.stop(context)
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun resume() {
        val id = uiState.active?.id ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            trips.resume(id).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, active = it, notice = "Perjalanan dilanjutkan.")
                    startTrackingIfPermitted(id)
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun finish() {
        val id = uiState.active?.id ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            trips.finish(id).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, active = null, notice = "Perjalanan selesai dan tersimpan.")
                    TripTrackingService.stop(context)
                    loadHistory()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun syncNow() {
        viewModelScope.launch {
            val ok = trips.flush()
            uiState = uiState.copy(notice = if (ok) "Sinkronisasi titik GPS selesai." else "Sinkronisasi tertunda, periksa koneksi.")
        }
    }

    private suspend fun loadHistory() {
        val history = trips.history().getOrDefault(uiState.history)
        uiState = uiState.copy(history = history)
    }

    private fun startTrackingIfPermitted(tripId: String) {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fine) {
            TripTrackingService.start(context, tripId)
        } else {
            uiState = uiState.copy(notice = "Izin lokasi diperlukan agar titik GPS dapat direkam.")
        }
    }

    fun clearMessages() {
        uiState = uiState.copy(error = null, notice = null)
    }

    fun reset() {
        TripTrackingService.stop(context)
        uiState = TripUiState()
    }
}
