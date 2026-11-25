package id.riderjourney.app.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import id.riderjourney.app.data.api.ConvoyDto
import id.riderjourney.app.data.api.ConvoyMemberDto
import id.riderjourney.app.ui.components.MapMarker
import id.riderjourney.app.ui.components.MessageBanner
import id.riderjourney.app.ui.components.RiderMap
import id.riderjourney.app.ui.components.SectionCard
import java.util.Locale

@Composable
fun ConvoyScreen(viewModel: ConvoyViewModel = hiltViewModel()) {
    val state = viewModel.uiState
    val context = LocalContext.current
    var permissionError by remember { mutableStateOf<String?>(null) }
    var pendingShare by remember { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var meetingLat by rememberSaveable { mutableStateOf("") }
    var meetingLng by rememberSaveable { mutableStateOf("") }
    var destinationLat by rememberSaveable { mutableStateOf("") }
    var destinationLng by rememberSaveable { mutableStateOf("") }
    var capacity by rememberSaveable { mutableStateOf("3") }
    var scheduledAt by rememberSaveable { mutableStateOf("") }
    var routeId by rememberSaveable { mutableStateOf("") }
    var waypoints by rememberSaveable { mutableStateOf("") }
    var joinCode by rememberSaveable { mutableStateOf("") }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            permissionError = null
            viewModel.onLocationPermissionGranted()
            if (pendingShare) {
                pendingShare = false
                viewModel.setSharing(true)
            }
        } else {
            pendingShare = false
            permissionError = "Izin lokasi presisi ditolak. Posisi tidak dikirim, tetapi Anda tetap dapat melihat anggota lain yang berbagi."
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Konvoi", style = MaterialTheme.typography.headlineSmall)
        if (state.loading) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.height(18.dp))
                Text("Memuat konvoi...", style = MaterialTheme.typography.bodySmall)
            }
        }
        state.error?.let { MessageBanner(it, isError = true) }
        state.notice?.let { MessageBanner(it, isError = false) }
        permissionError?.let { MessageBanner(it, isError = true) }

        val convoy = state.convoy
        if (convoy == null) {
            SectionCard("Buat konvoi") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Leader membuat titik kumpul, tujuan, dan kapasitas. Kode undangan ditampilkan sekali setelah konvoi dibuat.")
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Nama konvoi") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = meetingLat,
                            onValueChange = { meetingLat = it },
                            label = { Text("Lat kumpul") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            value = meetingLng,
                            onValueChange = { meetingLng = it },
                            label = { Text("Lng kumpul") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = destinationLat,
                            onValueChange = { destinationLat = it },
                            label = { Text("Lat tujuan") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            value = destinationLng,
                            onValueChange = { destinationLng = it },
                            label = { Text("Lng tujuan") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = capacity,
                            onValueChange = { capacity = it },
                            label = { Text("Kapasitas") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                        )
                        OutlinedTextField(
                            value = routeId,
                            onValueChange = { routeId = it },
                            label = { Text("ID rute (opsional)") },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    OutlinedTextField(
                        value = scheduledAt,
                        onValueChange = { scheduledAt = it },
                        label = { Text("Waktu mulai (ISO 8601)") },
                        supportingText = { Text("Contoh 2026-11-25T08:00:00+07:00. Kosongkan bila belum dijadwalkan.") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = waypoints,
                        onValueChange = { waypoints = it },
                        label = { Text("Waypoint (lat,lng,label; ...)") },
                        supportingText = { Text("Maksimal 7 waypoint. Pisahkan dengan titik koma.") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = {
                            viewModel.create(
                                name = name,
                                meetingLat = meetingLat,
                                meetingLng = meetingLng,
                                destinationLat = destinationLat,
                                destinationLng = destinationLng,
                                capacity = capacity,
                                scheduledAt = scheduledAt,
                                routeId = routeId,
                                waypointText = waypoints,
                            )
                        },
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (state.busy) "Membuat..." else "Buat konvoi") }
                }
            }

            SectionCard("Gabung lewat kode") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Minta kode undangan dari leader. Permintaan masuk ke leader untuk disetujui.")
                    OutlinedTextField(
                        value = joinCode,
                        onValueChange = { joinCode = it.uppercase() },
                        label = { Text("Kode undangan") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedButton(
                        onClick = { viewModel.join(joinCode) },
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Kirim permintaan bergabung") }
                }
            }
        } else {
            ConvoyHeader(convoy, state.connection)

            if (convoy.membershipStatus == "requested") {
                MessageBanner("Permintaan bergabung menunggu persetujuan leader. Anda belum menerima lokasi live.", isError = false)
            }

            if (convoy.membershipStatus == "active" && convoy.status in setOf("lobby", "active", "paused")) {
                SectionCard("Peta anggota") {
                    val membersById = state.members.associateBy { it.userId }
                    val markers = state.positions.mapNotNull { position ->
                        val member = membersById[position.userId] ?: return@mapNotNull null
                        if (!member.sharingConsent) return@mapNotNull null
                        MapMarker(
                            id = position.userId,
                            label = "${member.displayName} • ${if (position.stale) "stale" else "live"}",
                            lat = position.lat,
                            lng = position.lng,
                            stale = position.stale,
                        )
                    }
                    val routePoints = state.route?.geometry?.coordinates.orEmpty().mapNotNull { coordinate ->
                        if (coordinate.size >= 2 && coordinate[0].isFinite() && coordinate[1].isFinite()) {
                            coordinate[1] to coordinate[0]
                        } else {
                            null
                        }
                    }
                    RiderMap(Modifier.fillMaxWidth().height(260.dp), markers, routePoints)
                    state.route?.let { route ->
                        Text(
                            "Rute bersama: ${String.format(Locale.US, "%.1f", route.distanceM / 1000.0)} km • ${route.durationS / 60} menit",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                    Text(
                        "Hanya anggota aktif yang mengaktifkan berbagi lokasi yang tampil di peta.",
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    if (markers.isEmpty()) {
                        Text(
                            "Belum ada posisi yang dibagikan. Aktifkan berbagi lokasi atau tunggu anggota lain mengirim posisi.",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    if (state.connection != "connected") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Realtime: ${connectionLabel(state.connection)}", style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = viewModel::retryRealtime) { Text("Hubungkan ulang") }
                        }
                    }
                }

                SectionCard("Privasi lokasi") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Bagikan lokasi saya")
                            Text(
                                "Posisi hanya dikirim saat konvoi berjalan dan berhenti saat berbagi dimatikan.",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Switch(
                            checked = convoy.sharingConsent == true,
                            onCheckedChange = { enabled ->
                                if (enabled) {
                                    val granted = ContextCompat.checkSelfPermission(
                                        context,
                                        Manifest.permission.ACCESS_FINE_LOCATION,
                                    ) == PackageManager.PERMISSION_GRANTED
                                    if (granted) viewModel.setSharing(true) else {
                                        pendingShare = true
                                        permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                                    }
                                } else {
                                    viewModel.setSharing(false)
                                }
                            },
                        )
                    }
                }
            }

            if (convoy.status in setOf("lobby", "active", "paused")) {
                ConvoyMembers(state.members, convoy, state.busy, viewModel)
            }

            val canManage = convoy.role == "leader" || convoy.role == "co_leader"
            if (canManage && convoy.status in setOf("lobby", "active", "paused")) {
                SectionCard("Undangan") {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Kode disimpan sebagai hash di server dan hanya ditampilkan sekali saat dibuat.")
                        val invite = state.invite
                        if (invite != null) {
                            SelectionContainer {
                                Column {
                                    Text(invite.code, style = MaterialTheme.typography.titleLarge)
                                    invite.link?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                    Text("Maksimal ${invite.maxUses} pemakaian.", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        } else {
                            Text("Belum ada kode baru pada sesi ini.")
                        }
                        OutlinedButton(onClick = viewModel::createInvite, enabled = !state.busy) {
                            Text(if (invite == null) "Buat kode undangan" else "Buat kode baru")
                        }
                    }
                }

                SectionCard("Rute konvoi") {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Rute: ${convoy.routeId ?: "belum dipilih"} • versi ${convoy.routeVersion}")
                        Text(
                            "Perubahan rute disiarkan ke seluruh anggota aktif. Tempel ID rute yang tersimpan di akun Anda.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        OutlinedTextField(
                            value = routeId,
                            onValueChange = { routeId = it },
                            label = { Text("ID rute") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedButton(
                            onClick = { viewModel.updateRoute(routeId) },
                            enabled = !state.busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Perbarui rute") }
                    }
                }
            }

            val terminal = convoy.status in setOf("completed", "cancelled")
            if (terminal) {
                SectionCard("Konvoi berakhir") {
                    Text("Status: ${convoyStatusLabel(convoy.status)}. Lokasi live anggota sudah dihapus dan room ditutup.")
                    Button(onClick = viewModel::reset, modifier = Modifier.padding(top = 8.dp)) {
                        Text("Mulai konvoi baru")
                    }
                }
            } else {
                SectionCard("Status konvoi") {
                    Text("Versi ${convoy.version} • ${convoy.activeMemberCount}/${convoy.capacity} anggota aktif")
                    Text(
                        "Lifecycle: draft → lobby → active → paused → completed/cancelled.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        if (convoy.role == "leader") {
                            when (convoy.status) {
                                "draft" -> Button(
                                    onClick = { viewModel.start() },
                                    enabled = !state.busy,
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text("Mulai konvoi") }
                                "lobby" -> Button(
                                    onClick = { viewModel.start() },
                                    enabled = !state.busy,
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text("Mulai konvoi") }
                                "active" -> OutlinedButton(
                                    onClick = { viewModel.pause() },
                                    enabled = !state.busy,
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text("Jeda konvoi") }
                                "paused" -> Button(
                                    onClick = { viewModel.resume() },
                                    enabled = !state.busy,
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text("Lanjutkan konvoi") }
                            }
                            if (convoy.status in setOf("active", "paused")) {
                                Button(
                                    onClick = { viewModel.complete() },
                                    enabled = !state.busy,
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text("Selesaikan konvoi") }
                            }
                            if (convoy.status != "draft") {
                                OutlinedButton(
                                    onClick = { viewModel.cancel() },
                                    enabled = !state.busy,
                                    modifier = Modifier.fillMaxWidth(),
                                ) { Text("Batalkan konvoi") }
                            }
                        } else {
                            Text("Lifecycle dikendalikan leader.", style = MaterialTheme.typography.bodySmall)
                        }
                        OutlinedButton(
                            onClick = viewModel::leave,
                            enabled = !state.busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (convoy.membershipStatus == "requested") "Batalkan permintaan" else "Keluar dari konvoi") }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConvoyHeader(convoy: ConvoyDto, connection: String) {
    SectionCard("Konvoi ${convoy.name}") {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${convoyStatusLabel(convoy.status)} • ${roleLabel(convoy.role)}", style = MaterialTheme.typography.titleMedium)
            Text("${convoy.activeMemberCount}/${convoy.capacity} anggota aktif • versi ${convoy.version}")
            Text(
                "Titik kumpul %.5f, %.5f".format(Locale.US, convoy.meetingPoint.lat, convoy.meetingPoint.lng),
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                "Tujuan %.5f, %.5f".format(Locale.US, convoy.destination.lat, convoy.destination.lng),
                style = MaterialTheme.typography.bodySmall,
            )
            convoy.scheduledAt?.let { scheduled ->
                Text("Dijadwalkan: $scheduled", style = MaterialTheme.typography.bodySmall)
            }
            convoy.waypoints.takeIf { it.isNotEmpty() }?.let { waypointList ->
                Text("${waypointList.size} waypoint", style = MaterialTheme.typography.bodySmall)
            }
            if (connection == "denied") {
                Text("Realtime ditolak. Periksa keanggotaan atau minta tiket baru.", color = MaterialTheme.colorScheme.error)
            } else {
                Text("Realtime: ${connectionLabel(connection)}", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun ConvoyMembers(
    members: List<ConvoyMemberDto>,
    convoy: ConvoyDto,
    busy: Boolean,
    viewModel: ConvoyViewModel,
) {
    val canManage = convoy.role == "leader" || convoy.role == "co_leader"
    SectionCard("Anggota") {
        if (members.isEmpty()) {
            Text("Belum ada anggota aktif. Bagikan kode undangan kepada rider yang akan ikut.")
            return@SectionCard
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            members.forEach { member ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(member.displayName, style = MaterialTheme.typography.titleSmall)
                            Text(roleLabel(member.role), style = MaterialTheme.typography.labelMedium)
                        }
                        Text("@${member.username} • ${memberStatusLabel(member.status)}")
                        if (member.status == "active") {
                            Text(
                                when (member.locationStatus) {
                                    "live" -> "Lokasi live"
                                    "stale" -> "Lokasi stale"
                                    "waiting" -> "Menunggu posisi"
                                    "not_sharing" -> "Tidak berbagi lokasi"
                                    else -> if (member.presence == "online") "Online" else "Offline"
                                },
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        if (canManage && member.status == "requested") {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { viewModel.approve(member.userId) }, enabled = !busy) { Text("Setujui") }
                                OutlinedButton(onClick = { viewModel.reject(member.userId) }, enabled = !busy) { Text("Tolak") }
                            }
                        }
                        if (canManage && member.status == "active" && member.role != "leader") {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (convoy.role == "leader" && member.role != "co_leader") {
                                    TextButton(onClick = { viewModel.makeCoLeader(member.userId) }, enabled = !busy) {
                                        Text("Jadikan co-leader")
                                    }
                                }
                                if (convoy.role == "leader") {
                                    TextButton(onClick = { viewModel.transferLeadership(member.userId) }, enabled = !busy) {
                                        Text("Alihkan kepemimpinan")
                                    }
                                }
                                TextButton(onClick = { viewModel.remove(member.userId) }, enabled = !busy) {
                                    Text("Keluarkan")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun convoyStatusLabel(status: String): String = when (status) {
    "draft" -> "Draf"
    "lobby" -> "Lobby"
    "active" -> "Berjalan"
    "paused" -> "Dijeda"
    "completed" -> "Selesai"
    "cancelled" -> "Dibatalkan"
    else -> status
}

private fun roleLabel(role: String?): String = when (role) {
    "leader" -> "Leader"
    "co_leader" -> "Co-leader"
    "member" -> "Anggota"
    else -> role ?: "Anggota"
}

private fun memberStatusLabel(status: String): String = when (status) {
    "active" -> "aktif"
    "requested" -> "menunggu persetujuan"
    "left" -> "keluar"
    "removed" -> "dikeluarkan"
    else -> status
}

private fun connectionLabel(status: String): String = when (status) {
    "connected" -> "terhubung"
    "connecting" -> "menyambung"
    "reconnecting" -> "menyambung ulang"
    "offline" -> "offline"
    "disconnected" -> "terputus"
    "denied" -> "ditolak"
    "error" -> "gagal"
    else -> "belum terhubung"
}
