package id.riderjourney.app.ui.components

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import id.riderjourney.app.data.api.LatLngDto

data class UserLocationState(
    val location: LatLngDto? = null,
    val loading: Boolean = false,
    val error: String? = null,
)

/**
 * Reads the last known position only after the user grants precise location.
 * No position is fabricated when permission is missing or GPS is off.
 */
@Composable
fun rememberUserLocation(): Pair<UserLocationState, () -> Unit> {
    val context = LocalContext.current
    val client = remember(context.applicationContext) {
        LocationServices.getFusedLocationProviderClient(context.applicationContext)
    }
    var state by remember { mutableStateOf(UserLocationState()) }

    @SuppressLint("MissingPermission")
    fun refresh() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        state = state.copy(loading = true, error = null)
        try {
            client.lastLocation
                .addOnSuccessListener { location ->
                    state = if (location == null) {
                        state.copy(
                            loading = false,
                            error = "Lokasi terakhir belum tersedia. Aktifkan GPS lalu coba lagi.",
                        )
                    } else {
                        state.copy(
                            loading = false,
                            location = LatLngDto(location.latitude, location.longitude),
                            error = null,
                        )
                    }
                }
                .addOnFailureListener { error ->
                    state = state.copy(loading = false, error = error.message ?: "Lokasi tidak dapat dibaca.")
                }
        } catch (_: SecurityException) {
            state = state.copy(loading = false, error = "Izin lokasi diperlukan untuk menampilkan posisi Anda.")
        }
    }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            refresh()
        } else {
            state = state.copy(loading = false, error = "Izin lokasi ditolak; posisi Anda tidak ditampilkan.")
        }
    }

    fun request() {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) refresh() else launcher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    return state to ::request
}
