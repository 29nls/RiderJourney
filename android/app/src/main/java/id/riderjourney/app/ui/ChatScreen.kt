package id.riderjourney.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import id.riderjourney.app.data.api.MessageDto

@Composable
fun ChatScreen(viewModel: ChatViewModel = hiltViewModel()) {
    val state = viewModel.uiState
    var draft by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(Unit) {
        if (state.messages.isEmpty() && state.convoyId == null) viewModel.load()
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Chat konvoi", style = MaterialTheme.typography.titleLarge)
        Text(
            if (state.convoyId == null) "Pesan hanya dapat dikirim setelah konvoi aktif." else "Pesan terlihat oleh anggota aktif konvoi.",
            style = MaterialTheme.typography.bodySmall,
        )
        state.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = viewModel::dismissNotice) { Text("Tutup") }
        }
        state.notice?.let {
            Text(it, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = viewModel::dismissNotice) { Text("Tutup") }
        }
        HorizontalDivider(Modifier.padding(vertical = 8.dp))

        when {
            state.loading -> Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) {
                CircularProgressIndicator()
            }
            state.messages.isEmpty() -> Text(
                "Belum ada pesan. Mulai percakapan dengan menyapa anggota konvoi.",
                style = MaterialTheme.typography.bodyMedium,
            )
            else -> LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (state.nextCursor != null) {
                    item {
                        TextButton(onClick = viewModel::loadOlder, enabled = !state.loadingMore) {
                            Text(if (state.loadingMore) "Memuat…" else "Muat pesan lama")
                        }
                    }
                }
                items(state.messages, key = { it.id }) { message -> MessageRow(message, viewModel::retry) }
            }
        }

        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Tulis pesan") },
                maxLines = 3,
            )
            Button(
                onClick = {
                    viewModel.send(draft)
                    draft = ""
                },
                enabled = draft.isNotBlank() && state.convoyId != null && !state.sending,
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("Kirim") }
        }
    }
}

@Composable
private fun MessageRow(message: MessageDto, onRetry: (String) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            message.sender.displayName.ifBlank { message.sender.username },
            style = MaterialTheme.typography.labelMedium,
        )
        Text(
            message.body ?: message.location?.let { "(lokasi dibagikan)" } ?: "(pesan)",
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 4,
            overflow = TextOverflow.Ellipsis,
        )
        when (message.deliveryState) {
            "sending" -> Text("mengirim…", style = MaterialTheme.typography.labelSmall)
            "failed" -> TextButton(onClick = { onRetry(message.clientMessageId) }) { Text("Gagal — coba lagi") }
            "hidden" -> Text("disembunyikan moderator", style = MaterialTheme.typography.labelSmall)
        }
    }
}
