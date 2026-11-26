package id.riderjourney.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import id.riderjourney.app.data.api.HazardDto

@Composable
fun HazardScreen(viewModel: HazardViewModel = hiltViewModel()) {
    val state = viewModel.uiState
    var kind by rememberSaveable { mutableStateOf(hazardKinds.first().first) }
    var note by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) {
        if (state.items.isEmpty() && !state.loading && state.error == null) viewModel.refresh()
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Bahaya di sekitar", style = MaterialTheme.typography.titleLarge)
        Text(
            "Laporan memakai posisi GPS Anda saat ini dan berakhir otomatis sesuai masa berlaku server.",
            style = MaterialTheme.typography.bodySmall,
        )
        state.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = viewModel::dismiss) { Text("Tutup") }
        }
        state.notice?.let {
            Text(it, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = viewModel::dismiss) { Text("Tutup") }
        }

        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 8.dp)) {
            items(hazardKinds.map { it.first }) { key ->
                val label = hazardKinds.first { it.first == key }.second
                if (key == kind) {
                    Button(onClick = { kind = key }) { Text(label) }
                } else {
                    OutlinedButton(onClick = { kind = key }) { Text(label) }
                }
            }
        }

        OutlinedTextField(
            value = note,
            onValueChange = { note = it.take(500) },
            label = { Text("Catatan (opsional)") },
            modifier = Modifier.fillMaxWidth(),
            maxLines = 2,
        )
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    viewModel.report(kind, note)
                    note = ""
                },
                enabled = !state.busy,
            ) { Text(if (state.busy) "Mengirim…" else "Laporkan di lokasi saya") }
            OutlinedButton(onClick = viewModel::refresh, enabled = !state.loading) { Text("Muat ulang") }
        }

        HorizontalDivider()

        when {
            state.loading -> Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) {
                CircularProgressIndicator()
            }
            state.items.isEmpty() -> Text("Tidak ada bahaya aktif dalam radius pencarian.", modifier = Modifier.padding(top = 12.dp))
            else -> LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.items, key = { it.id }) { hazard -> HazardRow(hazard, state.busy, viewModel::confirm) }
            }
        }
    }
}

@Composable
private fun HazardRow(hazard: HazardDto, busy: Boolean, onConfirm: (String, Boolean) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            hazardKinds.firstOrNull { it.first == hazard.kind }?.second ?: hazard.kind,
            style = MaterialTheme.typography.titleSmall,
        )
        Text(
            buildString {
                append(hazard.reporter?.displayName ?: "Pengendara")
                hazard.distanceM?.let { append(" · ${it} m") }
                append(" · ${hazard.stillPresentCount} masih ada / ${hazard.notRelevantCount} tidak relevan")
            },
            style = MaterialTheme.typography.bodySmall,
        )
        hazard.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        if (!hazard.active) {
            Text("Sudah kedaluwarsa atau disembunyikan", style = MaterialTheme.typography.labelSmall)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { onConfirm(hazard.id, true) }, enabled = !busy) { Text("Masih ada") }
                TextButton(onClick = { onConfirm(hazard.id, false) }, enabled = !busy) { Text("Tidak relevan") }
            }
        }
    }
}
