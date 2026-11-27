package id.riderjourney.app.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import id.riderjourney.app.data.api.VehicleDto
import id.riderjourney.app.data.api.VehicleRequest
import id.riderjourney.app.ui.components.MediaImage
import id.riderjourney.app.ui.components.MessageBanner

@Composable
fun GarageScreen(viewModel: GarageViewModel = hiltViewModel()) {
    val state = viewModel.uiState
    var editTarget by remember { mutableStateOf<VehicleDto?>(null) }
    var showAdd by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<VehicleDto?>(null) }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Garasi", style = MaterialTheme.typography.headlineSmall)
            Button(onClick = { showAdd = true }) { Text("Tambah") }
        }
        if (state.error != null) MessageBanner(state.error, isError = true)
        if (state.notice != null) MessageBanner(state.notice, isError = false)
        if (state.loading && state.vehicles.isEmpty()) CircularProgressIndicator()
        if (!state.loading && state.vehicles.isEmpty()) {
            Text("Belum ada kendaraan. Tambahkan motor atau mobil untuk mulai touring.")
        }
        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(state.vehicles, key = { it.id }) { vehicle ->
                VehicleCard(
                    vehicle = vehicle,
                    revealedPlate = state.revealedPlates[vehicle.id],
                    busy = state.busy,
                    uploadProgress = state.uploadProgress,
                    onPrimary = { viewModel.setPrimary(vehicle.id) },
                    onEdit = { editTarget = vehicle },
                    onReveal = { viewModel.revealPlate(vehicle.id) },
                    onDelete = { deleteTarget = vehicle },
                    onPhoto = { uri -> viewModel.uploadPhoto(vehicle, uri) },
                    onRemovePhoto = { viewModel.removePhoto(vehicle) },
                )
            }
        }
    }

    if (showAdd) {
        VehicleDialog(
            initial = null,
            busy = state.busy,
            onDismiss = { showAdd = false },
            onSave = {
                viewModel.create(it)
                showAdd = false
            },
        )
    }

    editTarget?.let { vehicle ->
        VehicleDialog(
            initial = vehicle,
            busy = state.busy,
            onDismiss = { editTarget = null },
            onSave = {
                viewModel.update(vehicle.id, it)
                editTarget = null
            },
        )
    }

    deleteTarget?.let { vehicle ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Hapus kendaraan?") },
            text = { Text("${vehicle.brand} ${vehicle.model} akan dihapus permanen dari garasi.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.delete(vehicle.id)
                    deleteTarget = null
                }) { Text("Hapus") }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Batal") } },
        )
    }
}

@Composable
private fun VehicleCard(
    vehicle: VehicleDto,
    revealedPlate: String?,
    busy: Boolean,
    uploadProgress: Float?,
    onPrimary: () -> Unit,
    onEdit: () -> Unit,
    onReveal: () -> Unit,
    onDelete: () -> Unit,
    onPhoto: (Uri) -> Unit,
    onRemovePhoto: () -> Unit,
) {
    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) onPhoto(uri)
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                MediaImage(
                    mediaId = vehicle.photoMediaId,
                    contentDescription = "Foto ${vehicle.brand} ${vehicle.model}",
                    modifier = Modifier
                        .size(84.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Text("Tanpa foto", style = MaterialTheme.typography.labelSmall)
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    OutlinedButton(onClick = { pickPhoto.launch("image/*") }, enabled = !busy) {
                        Text(if (vehicle.photoMediaId == null) "Unggah foto" else "Ganti foto")
                    }
                    if (vehicle.photoMediaId != null) {
                        TextButton(onClick = onRemovePhoto, enabled = !busy) { Text("Hapus foto") }
                    }
                }
            }
            if (uploadProgress != null) {
                LinearProgressIndicator(progress = { uploadProgress }, modifier = Modifier.fillMaxWidth())
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    vehicle.nickname?.takeIf { it.isNotBlank() } ?: "${vehicle.brand} ${vehicle.model}",
                    style = MaterialTheme.typography.titleMedium,
                )
                if (vehicle.isPrimary) Text("UTAMA", style = MaterialTheme.typography.labelSmall)
            }
            Text("${vehicle.brand} ${vehicle.model} • ${typeLabel(vehicle.type)}")
            vehicle.year?.let { Text("Tahun $it") }
            vehicle.engineCc?.let { Text("${it} cc") }
            Text(
                when {
                    !vehicle.hasPlate -> "Tanpa nomor polisi"
                    revealedPlate != null -> "Plat: $revealedPlate"
                    else -> "Nomor polisi privat"
                },
                style = MaterialTheme.typography.bodySmall,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (vehicle.hasPlate && revealedPlate == null) {
                    OutlinedButton(onClick = onReveal, enabled = !busy) { Text("Lihat plat") }
                }
                OutlinedButton(onClick = onEdit, enabled = !busy) { Text("Ubah") }
                if (!vehicle.isPrimary) {
                    OutlinedButton(onClick = onPrimary, enabled = !busy) { Text("Jadikan utama") }
                }
            }
            TextButton(onClick = onDelete, enabled = !busy) { Text("Hapus kendaraan") }
        }
    }
}

@Composable
private fun VehicleDialog(
    initial: VehicleDto?,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (VehicleRequest) -> Unit,
) {
    var type by remember(initial?.id) { mutableStateOf(initial?.type ?: "motorcycle") }
    var brand by remember(initial?.id) { mutableStateOf(initial?.brand.orEmpty()) }
    var model by remember(initial?.id) { mutableStateOf(initial?.model.orEmpty()) }
    var year by remember(initial?.id) { mutableStateOf(initial?.year?.toString().orEmpty()) }
    var engineCc by remember(initial?.id) { mutableStateOf(initial?.engineCc?.toString().orEmpty()) }
    var nickname by remember(initial?.id) { mutableStateOf(initial?.nickname.orEmpty()) }
    var plate by remember(initial?.id) { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "Tambah kendaraan" else "Ubah kendaraan") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("motorcycle" to "Motor", "car" to "Mobil", "other" to "Lain").forEach { (value, label) ->
                        FilterChip(selected = type == value, onClick = { type = value }, label = { Text(label) })
                    }
                }
                OutlinedTextField(brand, { brand = it }, label = { Text("Merek") }, singleLine = true)
                OutlinedTextField(model, { model = it }, label = { Text("Model") }, singleLine = true)
                OutlinedTextField(nickname, { nickname = it }, label = { Text("Nama panggilan (opsional)") }, singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        year,
                        { year = it.filter(Char::isDigit) },
                        label = { Text("Tahun") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        engineCc,
                        { engineCc = it.filter(Char::isDigit) },
                        label = { Text("cc") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }
                OutlinedTextField(
                    plate,
                    { plate = it },
                    label = { Text(if (initial == null) "Nomor polisi (privat)" else "Nomor polisi baru (opsional)") },
                    singleLine = true,
                )
                Text("Nomor polisi disimpan terenkripsi dan hanya terlihat oleh Anda.", style = MaterialTheme.typography.labelSmall)
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onSave(
                        VehicleRequest(
                            type = type,
                            brand = brand.trim(),
                            model = model.trim(),
                            year = year.toIntOrNull(),
                            engineCc = engineCc.toIntOrNull(),
                            nickname = nickname.trim().ifBlank { null },
                            plate = plate.trim().uppercase().ifBlank { null },
                        ),
                    )
                },
                enabled = !busy && brand.isNotBlank() && model.isNotBlank(),
            ) { Text("Simpan") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}

private fun typeLabel(type: String): String = when (type) {
    "motorcycle" -> "Motor"
    "car" -> "Mobil"
    else -> "Lainnya"
}
