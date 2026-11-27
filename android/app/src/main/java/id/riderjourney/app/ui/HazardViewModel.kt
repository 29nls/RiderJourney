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
import com.google.android.gms.location.LocationServices
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import id.riderjourney.app.data.HazardRepository
import id.riderjourney.app.data.api.CreateHazardRequest
import id.riderjourney.app.data.api.HazardDto
import id.riderjourney.app.data.api.HazardPointDto
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

data class HazardUiState(
    val items: List<HazardDto> = emptyList(),
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val hasLocation: Boolean = false,
)

private val HAZARD_KINDS = listOf(
    "road_damage" to "Jalan rusak",
    "accident" to "Kecelakaan",
    "congestion" to "Macet",
    "police" to "Petugas",
    "weather" to "Cuaca",
    "obstacle" to "Penghalang",
    "other" to "Lainnya",
)

val hazardKinds: List<Pair<String, String>> get() = HAZARD_KINDS

@HiltViewModel
class HazardViewModel @Inject constructor(
    private val hazards: HazardRepository,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    var uiState by mutableStateOf(HazardUiState())
        private set

    private val fused by lazy { LocationServices.getFusedLocationProviderClient(context) }
    private var lastLat: Double? = null
    private var lastLng: Double? = null

    private fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Reporting needs the rider's actual position, not a map centre: a hazard
     * pinned where the map happens to be looking would send other riders to the
     * wrong place. If the fix is unavailable the action is refused with a reason.
     */
    private fun withLocation(action: String, block: (Double, Double) -> Unit) {
        if (!hasLocationPermission()) {
            uiState = uiState.copy(error = "Izin lokasi diperlukan untuk $action. Aktifkan izin lokasi lalu coba lagi.")
            return
        }
        // The runtime grant is checked above; the catch covers a permission
        // revoked between that check and the call.
        try {
            fused.lastLocation
                .addOnSuccessListener { location ->
                    if (location == null) {
                        uiState = uiState.copy(error = "Lokasi saat ini belum tersedia. Coba lagi di area terbuka.")
                    } else {
                        lastLat = location.latitude
                        lastLng = location.longitude
                        uiState = uiState.copy(hasLocation = true, error = null)
                        block(location.latitude, location.longitude)
                    }
                }
                .addOnFailureListener { uiState = uiState.copy(error = "Lokasi tidak dapat dibaca.") }
        } catch (_: SecurityException) {
            uiState = uiState.copy(error = "Izin lokasi dicabut. Aktifkan izin lokasi lalu coba lagi.")
        }
    }

    fun refresh() = withLocation("memuat bahaya di sekitar") { lat, lng -> load(lat, lng) }

    private fun load(lat: Double, lng: Double) {
        if (uiState.loading) return
        uiState = uiState.copy(loading = true, error = null)
        viewModelScope.launch {
            hazards.nearby(lat, lng).fold(
                onSuccess = { response -> uiState = uiState.copy(items = response.items, loading = false) },
                onFailure = { error -> uiState = uiState.copy(loading = false, error = error.message) },
            )
        }
    }

    fun report(kind: String, note: String?) = withLocation("melaporkan bahaya") { lat, lng ->
        if (uiState.busy) return@withLocation
        uiState = uiState.copy(busy = true, error = null)
        viewModelScope.launch {
            hazards.create(
                CreateHazardRequest(
                    kind = kind,
                    location = HazardPointDto(lat = lat, lng = lng),
                    observedAt = Instant.now().toString(),
                    note = note?.trim()?.takeIf { it.isNotEmpty() },
                ),
            ).fold(
                onSuccess = { created ->
                    uiState = uiState.copy(
                        items = listOf(created) + uiState.items,
                        busy = false,
                        notice = "Laporan terkirim. Pengendara lain akan melihatnya sampai kedaluwarsa.",
                    )
                },
                onFailure = { error -> uiState = uiState.copy(busy = false, error = error.message) },
            )
        }
    }

    fun confirm(id: String, stillPresent: Boolean) {
        if (uiState.busy) return
        uiState = uiState.copy(busy = true, error = null)
        viewModelScope.launch {
            hazards.confirm(id, if (stillPresent) "still_present" else "not_relevant").fold(
                onSuccess = { result ->
                    uiState = uiState.copy(
                        items = uiState.items.map { if (it.id == id) result.hazard else it },
                        busy = false,
                        notice = if (stillPresent) "Konfirmasi dicatat." else "Ditandai tidak relevan.",
                    )
                },
                onFailure = { error -> uiState = uiState.copy(busy = false, error = error.message) },
            )
        }
    }

    fun dismiss() {
        uiState = uiState.copy(error = null, notice = null)
    }
}
