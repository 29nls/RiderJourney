package id.riderjourney.app.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import id.riderjourney.app.data.api.TripDto
import id.riderjourney.app.ui.components.MessageBanner
import id.riderjourney.app.ui.components.SectionCard

@Composable
fun TripsScreen(viewModel: TripViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val state = viewModel.uiState
    var permissionError by remember { mutableStateOf<String?>(null) }

    val fineLocationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            permissionError = null
            viewModel.start()
        } else {
            permissionError = "Izin lokasi ditolak. Perjalanan tidak dimulai agar tidak ada data palsu."
        }
    }
    val backgroundLocationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionError = if (granted) null else "Izin lokasi latar belakang ditolak. Perekaman hanya berjalan saat aplikasi dipakai."
    }
    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    fun requestStart() {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (granted) viewModel.start() else fineLocationLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Perjalanan", style = MaterialTheme.typography.headlineSmall)
        if (state.error != null) MessageBanner(state.error, isError = true)
        if (state.notice != null) MessageBanner(state.notice, isError = false)
        permissionError?.let { MessageBanner(it, isError = true) }

        SectionCard("Rekaman") {
            val active = state.active
            if (active == null) {
                Text("Mulai perjalanan untuk merekam titik GPS. Data disimpan lokal bila koneksi terputus.")
                Button(
                    onClick = ::requestStart,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    enabled = !state.busy,
                ) { Text(if (state.busy) "Memulai..." else "Mulai perjalanan") }
            } else {
                TripSummary(active)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    when (active.status) {
                        "active" -> OutlinedButton(onClick = viewModel::pause, enabled = !state.busy) { Text("Jeda") }
                        "paused" -> OutlinedButton(onClick = viewModel::resume, enabled = !state.busy) { Text("Lanjutkan") }
                    }
                    Button(onClick = viewModel::finish, enabled = !state.busy) { Text("Selesai") }
                }
                OutlinedButton(onClick = viewModel::syncNow, modifier = Modifier.padding(top = 8.dp)) {
                    Text("Sinkronkan titik GPS")
                }
            }
            if (state.loading) CircularProgressIndicator(Modifier.padding(top = 8.dp))
        }

        SectionCard("Izin lokasi") {
            val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val background = if (Build.VERSION.SDK_INT >= 29) {
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
            } else true
            Text("Lokasi presisi: ${if (fine) "diizinkan" else "belum diizinkan"}")
            Text("Lokasi latar belakang: ${if (background) "diizinkan" else "belum diizinkan"}")
            Text(
                "Perekaman memakai foreground service. Android 11+ mewajibkan izin 'Sepanjang waktu' dipilih dari halaman pengaturan aplikasi.",
                style = MaterialTheme.typography.bodySmall,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!fine) {
                    OutlinedButton(onClick = { fineLocationLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION) }) {
                        Text("Izin lokasi")
                    }
                }
                if (!background) {
                    OutlinedButton(onClick = {
                        if (Build.VERSION.SDK_INT >= 30) {
                            context.startActivity(
                                Intent(
                                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.fromParts("package", context.packageName, null),
                                ),
                            )
                        } else if (Build.VERSION.SDK_INT >= 29) {
                            // Background location only exists from API 29; on older
                            // devices the settings deep link above is the only path.
                            backgroundLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                        }
                    }) { Text("Izin latar belakang") }
                }
                if (Build.VERSION.SDK_INT >= 33 &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    OutlinedButton(onClick = { notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }) {
                        Text("Izin notifikasi")
                    }
                }
            }
        }

        SectionCard("Riwayat") {
            if (state.history.isEmpty()) {
                Text("Belum ada riwayat perjalanan selesai.")
            } else {
                state.history.forEach { trip ->
                    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Column(Modifier.padding(10.dp)) {
                            Text(statusLabel(trip.status), style = MaterialTheme.typography.titleSmall)
                            Text("${"%.2f".format(trip.distanceM / 1000.0)} km • ${formatDuration(trip.durationS)} • ${trip.pointCount} titik")
                            trip.maxSpeedKph?.let { Text("Kecepatan maksimum: ${"%.1f".format(it)} km/j") }
                            trip.dataQuality?.let { Text("Kualitas data: $it", style = MaterialTheme.typography.labelSmall) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TripSummary(trip: TripDto) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text("Status: ${statusLabel(trip.status)}", style = MaterialTheme.typography.titleSmall)
        Text("Jarak: ${"%.2f".format(trip.distanceM / 1000.0)} km")
        Text("Durasi: ${formatDuration(trip.durationS)}")
        Text("Waktu bergerak: ${formatDuration(trip.movingS)}")
        Text("Titik: ${trip.pointCount}")
        trip.avgSpeedKph?.let { Text("Kecepatan rata-rata: ${"%.1f".format(it)} km/j") }
        trip.maxSpeedKph?.let { Text("Kecepatan maksimum: ${"%.1f".format(it)} km/j") }
        trip.startLocation?.let { Text("Mulai: ${"%.5f".format(it.lat)}, ${"%.5f".format(it.lng)}") }
        trip.endLocation?.let { Text("Selesai: ${"%.5f".format(it.lat)}, ${"%.5f".format(it.lng)}") }
    }
}
