package id.riderjourney.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import id.riderjourney.app.data.api.MeDto
import id.riderjourney.app.ui.components.MessageBanner
import id.riderjourney.app.ui.components.RiderMap
import id.riderjourney.app.ui.components.SectionCard
import id.riderjourney.app.ui.components.rememberUserLocation

@Composable
fun HomeScreen(
    session: MeDto,
    tripViewModel: TripViewModel,
    onOpenRoute: () -> Unit,
    onOpenGarage: () -> Unit,
    onOpenTrips: () -> Unit,
) {
    val tripState = tripViewModel.uiState
    val (userLocation, requestLocation) = rememberUserLocation()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Halo, ${session.displayName}", style = MaterialTheme.typography.headlineSmall)
        Text(
            if (session.emailVerified) "Akun terverifikasi" else "Email belum diverifikasi",
            style = MaterialTheme.typography.bodySmall,
        )
        if (tripState.error != null) MessageBanner(tripState.error, isError = true)

        SectionCard("Perjalanan aktif") {
            val active = tripState.active
            if (active == null) {
                Text("Belum ada perjalanan aktif. Mulai dari tab Trip saat siap berkendara.")
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Status: ${statusLabel(active.status)}")
                    Text("Jarak: ${"%.2f".format(active.distanceM / 1000.0)} km")
                    Text("Durasi: ${formatDuration(active.durationS)}")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onOpenTrips) { Text("Buka Trip") }
                        if (active.status == "active") {
                            OutlinedButton(onClick = tripViewModel::pause) { Text("Jeda") }
                        }
                    }
                }
            }
        }

        SectionCard("Peta") {
            RiderMap(
                modifier = Modifier.fillMaxWidth().height(230.dp),
                userLocation = userLocation.location,
                locationLoading = userLocation.loading,
                onRequestLocation = requestLocation,
            )
            userLocation.error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }

        SectionCard("Akses cepat") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onOpenRoute, modifier = Modifier.fillMaxWidth()) { Text("Cari tempat & preview rute") }
                OutlinedButton(onClick = onOpenGarage, modifier = Modifier.fillMaxWidth()) { Text("Kelola garasi") }
                OutlinedButton(onClick = onOpenTrips, modifier = Modifier.fillMaxWidth()) { Text("Rekam perjalanan") }
            }
        }
    }
}

fun statusLabel(status: String): String = when (status) {
    "active" -> "Berjalan"
    "paused" -> "Dijeda"
    "finished" -> "Selesai"
    else -> status
}

fun formatDuration(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return if (hours > 0) "$hours jam $minutes menit" else "$minutes menit"
}
