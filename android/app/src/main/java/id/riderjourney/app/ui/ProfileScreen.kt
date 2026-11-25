package id.riderjourney.app.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.LaunchedEffect
import id.riderjourney.app.data.api.MeDto
import id.riderjourney.app.data.api.UpdateProfileRequest
import id.riderjourney.app.data.api.UpdateSettingsRequest
import id.riderjourney.app.ui.components.MessageBanner
import id.riderjourney.app.ui.components.SectionCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL

@Composable
fun ProfileScreen(session: MeDto, viewModel: SessionViewModel) {
    val state = viewModel.uiState
    var displayName by rememberSaveable(session.id) { mutableStateOf(session.displayName) }
    var bio by rememberSaveable(session.id) { mutableStateOf(session.bio.orEmpty()) }
    var city by rememberSaveable(session.id) { mutableStateOf(session.city.orEmpty()) }
    var avatarUrl by rememberSaveable(session.id) { mutableStateOf(session.avatarUrl.orEmpty()) }
    var visibility by rememberSaveable(session.id) { mutableStateOf(session.visibility) }
    var historyVisibility by rememberSaveable(session.id) {
        mutableStateOf(session.settings?.tripHistoryVisibility ?: "private")
    }
    var locationDefault by rememberSaveable(session.id) {
        mutableStateOf(session.settings?.locationSharingDefault ?: false)
    }
    var showLogout by remember { mutableStateOf(false) }

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
            AvatarImage(avatarUrl.trim(), displayName)
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
            OutlinedTextField(
                value = avatarUrl,
                onValueChange = { avatarUrl = it },
                label = { Text("URL foto profil (http/https)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Text("Visibilitas profil", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("public" to "Publik", "followers" to "Pengikut", "private" to "Privat").forEach { (value, label) ->
                    FilterChip(selected = visibility == value, onClick = { visibility = value }, label = { Text(label) })
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = {
                        viewModel.updateProfile(
                            UpdateProfileRequest(
                                displayName = displayName.trim().ifBlank { null },
                                bio = bio.trim().ifBlank { null },
                                city = city.trim().ifBlank { null },
                                avatarUrl = avatarUrl.trim(),
                                visibility = visibility,
                            ),
                        )
                    },
                    modifier = Modifier.weight(1f),
                    enabled = !state.busy,
                ) { Text("Simpan profil") }
                OutlinedButton(
                    onClick = {
                        avatarUrl = ""
                        viewModel.updateProfile(UpdateProfileRequest(avatarUrl = ""))
                    },
                    enabled = !state.busy && avatarUrl.isNotBlank(),
                ) { Text("Hapus foto") }
            }
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
private fun AvatarImage(url: String, displayName: String) {
    var bitmap by remember(url) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(url) { mutableStateOf(false) }
    LaunchedEffect(url) {
        bitmap = null
        failed = false
        if (url.isBlank()) return@LaunchedEffect
        val loaded = withContext(Dispatchers.IO) {
            runCatching {
                val connection = URL(url).openConnection()
                connection.connectTimeout = 8_000
                connection.readTimeout = 8_000
                connection.getInputStream().use { BitmapFactory.decodeStream(it) }
            }.getOrNull()
        }
        bitmap = loaded
        failed = loaded == null
    }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Box(
            modifier = Modifier
                .size(84.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.secondaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            val image = bitmap
            if (image != null) {
                Image(
                    bitmap = image.asImageBitmap(),
                    contentDescription = "Foto profil",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Text(
                    displayName.trim().take(1).uppercase().ifBlank { "?" },
                    style = MaterialTheme.typography.headlineMedium,
                )
            }
        }
        if (failed) {
            Text(
                "Foto tidak dapat dimuat dari URL.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}
