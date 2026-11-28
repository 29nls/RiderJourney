package id.riderjourney.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import id.riderjourney.app.data.api.MeDto
import id.riderjourney.app.data.api.UpdateProfileRequest
import id.riderjourney.app.data.api.UpdateSettingsRequest
import id.riderjourney.app.ui.components.MediaImage
import id.riderjourney.app.ui.components.MessageBanner
import id.riderjourney.app.ui.components.SectionCard

@Composable
fun ProfileScreen(session: MeDto, viewModel: SessionViewModel) {
    val state = viewModel.uiState
    var displayName by rememberSaveable(session.id) { mutableStateOf(session.displayName) }
    var bio by rememberSaveable(session.id) { mutableStateOf(session.bio.orEmpty()) }
    var city by rememberSaveable(session.id) { mutableStateOf(session.city.orEmpty()) }
    var visibility by rememberSaveable(session.id) { mutableStateOf(session.visibility) }
    var historyVisibility by rememberSaveable(session.id) {
        mutableStateOf(session.settings?.tripHistoryVisibility ?: "private")
    }
    var locationDefault by rememberSaveable(session.id) {
        mutableStateOf(session.settings?.locationSharingDefault ?: false)
    }
    var showLogout by remember { mutableStateOf(false) }

    // Usage comes from server-side accounting: a media being deleted still
    // counts until the object is gone.
    LaunchedEffect(Unit) { viewModel.refreshQuota() }

    val pickAvatar = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) viewModel.uploadAvatar(uri)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Profil & privasi", style = MaterialTheme.typography.headlineSmall)
        if (state.error != null) MessageBanner(state.error, isError = true)
        if (state.notice != null) MessageBanner(state.notice, isError = false)

        SectionCard("Akun") {
            AvatarImage(mediaId = session.avatarMediaId, displayName = session.displayName)
            state.uploadProgress?.let { progress ->
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { pickAvatar.launch("image/*") },
                    modifier = Modifier.weight(1f),
                    enabled = !state.busy,
                ) { Text(if (session.avatarMediaId == null) "Unggah foto" else "Ganti foto") }
                OutlinedButton(
                    onClick = { viewModel.removeAvatar() },
                    enabled = !state.busy && session.avatarMediaId != null,
                ) { Text("Hapus foto") }
            }
            state.quota?.let { quota ->
                Text(
                    buildString {
                        append("Penyimpanan: ${formatBytes(quota.usedBytes)} dari ${formatBytes(quota.quotaBytes)}")
                        if (quota.deletionPendingBytes > 0) {
                            append(" · ${formatBytes(quota.deletionPendingBytes)} menunggu penghapusan")
                        }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Text(session.email, style = MaterialTheme.typography.bodyMedium)
            Text(if (session.emailVerified) "Email terverifikasi" else "Email belum terverifikasi")
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                label = { Text("Nama tampilan") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            OutlinedTextField(
                value = bio,
                onValueChange = { bio = it },
                label = { Text("Bio") },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            OutlinedTextField(
                value = city,
                onValueChange = { city = it },
                label = { Text("Kota") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Text("Visibilitas profil", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("public" to "Publik", "followers" to "Pengikut", "private" to "Privat").forEach { (value, label) ->
                    FilterChip(selected = visibility == value, onClick = { visibility = value }, label = { Text(label) })
                }
            }
            Button(
                onClick = {
                    viewModel.updateProfile(
                        UpdateProfileRequest(
                            displayName = displayName.trim().ifBlank { null },
                            bio = bio.trim().ifBlank { null },
                            city = city.trim().ifBlank { null },
                            visibility = visibility,
                        ),
                    )
                },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                enabled = !state.busy,
            ) { Text("Simpan profil") }
        }

        SectionCard("Pengaturan perjalanan") {
            Text("Riwayat perjalanan")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("private" to "Privat", "followers" to "Pengikut", "public" to "Publik").forEach { (value, label) ->
                    FilterChip(
                        selected = historyVisibility == value,
                        onClick = { historyVisibility = value },
                        label = { Text(label) },
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Bagikan lokasi secara default")
                Switch(checked = locationDefault, onCheckedChange = { locationDefault = it })
            }
            Button(
                onClick = {
                    viewModel.updateSettings(
                        UpdateSettingsRequest(
                            locationSharingDefault = locationDefault,
                            tripHistoryVisibility = historyVisibility,
                        ),
                    )
                },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                enabled = !state.busy,
            ) { Text("Simpan pengaturan") }
        }

        OutlinedButton(onClick = { showLogout = true }, modifier = Modifier.fillMaxWidth()) { Text("Keluar") }
    }

    if (showLogout) {
        AlertDialog(
            onDismissRequest = { showLogout = false },
            title = { Text("Keluar dari akun?") },
            text = { Text("Sesi di perangkat ini akan dihapus.") },
            confirmButton = {
                TextButton(onClick = {
                    showLogout = false
                    viewModel.logout()
                }) { Text("Keluar") }
            },
            dismissButton = { TextButton(onClick = { showLogout = false }) { Text("Batal") } },
        )
    }
}

@Composable
private fun AvatarImage(mediaId: String?, displayName: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth(),
    ) {
        MediaImage(
            mediaId = mediaId,
            contentDescription = "Foto profil",
            modifier = Modifier
                .size(84.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.secondaryContainer),
        ) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    displayName.trim().take(1).uppercase().ifBlank { "?" },
                    style = MaterialTheme.typography.headlineMedium,
                )
            }
        }
    }
}

/** Storage sizes are shown in the unit a rider expects, not raw bytes. */
private fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = listOf("KB", "MB", "GB")
    var value = bytes.toDouble() / 1024
    var index = 0
    while (value >= 1024 && index < units.lastIndex) {
        value /= 1024
        index += 1
    }
    return String.format(java.util.Locale.US, "%.1f %s", value, units[index])
}
