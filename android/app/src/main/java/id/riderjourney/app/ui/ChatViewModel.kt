package id.riderjourney.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.riderjourney.app.data.ApiException
import id.riderjourney.app.data.ChatRepository
import id.riderjourney.app.data.ConvoyRepository
import id.riderjourney.app.data.api.MessageDto
import id.riderjourney.app.data.api.MessageLocationDto
import id.riderjourney.app.data.api.MessageSenderDto
import id.riderjourney.app.data.api.SendMessageRequest
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID
import javax.inject.Inject

data class ChatUiState(
    val convoyId: String? = null,
    val messages: List<MessageDto> = emptyList(),
    val nextCursor: String? = null,
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val sending: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

/**
 * New pages arrive newest-first from the server while the screen reads oldest to
 * newest. Ids are the identity: a retried send can return the row that was
 * already stored, so appending blindly would show the same message twice.
 */
internal fun mergeMessages(existing: List<MessageDto>, incoming: List<MessageDto>): List<MessageDto> {
    val byId = LinkedHashMap<String, MessageDto>()
    for (message in existing + incoming) {
        if (byId[message.id] == null) byId[message.id] = message
    }
    return byId.values.sortedBy { it.createdAt }
}

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chat: ChatRepository,
    private val convoys: ConvoyRepository,
) : ViewModel() {
    var uiState by mutableStateOf(ChatUiState())
        private set

    fun load() {
        if (uiState.loading) return
        uiState = uiState.copy(loading = true, error = null)
        viewModelScope.launch {
            val active = convoys.active()
            val convoy = active.getOrNull()
            if (convoy == null) {
                uiState = uiState.copy(
                    loading = false,
                    error = active.exceptionOrNull()?.message
                        ?: "Belum ada konvoi aktif. Buat atau gabung konvoi untuk memakai chat.",
                )
                return@launch
            }
            chat.page(convoy.id).fold(
                onSuccess = { page ->
                    uiState = uiState.copy(
                        convoyId = convoy.id,
                        messages = mergeMessages(emptyList(), page.items.asReversed()),
                        nextCursor = page.nextCursor,
                        loading = false,
                    )
                },
                onFailure = { error ->
                    uiState = uiState.copy(loading = false, error = error.message)
                },
            )
        }
    }

    fun loadOlder() {
        val convoyId = uiState.convoyId ?: return
        val cursor = uiState.nextCursor ?: return
        if (uiState.loadingMore) return
        uiState = uiState.copy(loadingMore = true, error = null)
        viewModelScope.launch {
            chat.page(convoyId, before = cursor).fold(
                onSuccess = { page ->
                    uiState = uiState.copy(
                        messages = mergeMessages(uiState.messages, page.items.asReversed()),
                        nextCursor = page.nextCursor,
                        loadingMore = false,
                    )
                },
                onFailure = { error -> uiState = uiState.copy(loadingMore = false, error = error.message) },
            )
        }
    }

    /**
     * Optimistic send. The clientMessageId is generated once and reused by retry,
     * which is what makes the server's idempotency key effective instead of
     * creating a second row on every tap of "coba lagi".
     */
    fun send(body: String) {
        val convoyId = uiState.convoyId ?: return
        val text = body.trim()
        if (text.isEmpty() || uiState.sending) return
        val clientId = UUID.randomUUID().toString()
        val optimistic = MessageDto(
            id = "local:$clientId",
            convoyId = convoyId,
            clientMessageId = clientId,
            sender = MessageSenderDto(id = "me", displayName = "Anda"),
            kind = "text",
            body = text,
            deliveryState = "sending",
            createdAt = Instant.now().toString(),
        )
        uiState = uiState.copy(messages = uiState.messages + optimistic, sending = true, error = null)
        deliver(convoyId, optimistic)
    }

    fun retry(clientMessageId: String) {
        val convoyId = uiState.convoyId ?: return
        val failed = uiState.messages.firstOrNull { it.clientMessageId == clientMessageId } ?: return
        val marked = failed.copy(deliveryState = "sending")
        uiState = uiState.copy(
            messages = uiState.messages.map { if (it.clientMessageId == clientMessageId) marked else it },
            sending = true,
            error = null,
        )
        deliver(convoyId, marked)
    }

    private fun deliver(convoyId: String, pending: MessageDto) {
        viewModelScope.launch {
            val request = SendMessageRequest(
                clientMessageId = pending.clientMessageId,
                kind = "text",
                body = pending.body,
            )
            chat.send(convoyId, request).fold(
                onSuccess = { saved ->
                    uiState = uiState.copy(
                        messages = uiState.messages.map { if (it.clientMessageId == pending.clientMessageId) saved else it },
                        sending = false,
                    )
                },
                onFailure = { error -> markFailed(pending.clientMessageId, error) },
            )
        }
    }

    private fun markFailed(clientMessageId: String, error: Throwable) {
        uiState = uiState.copy(
            messages = uiState.messages.map {
                if (it.clientMessageId == clientMessageId) it.copy(deliveryState = "failed") else it
            },
            sending = false,
            error = when (error) {
                is ApiException -> if (error.code == "CHAT_BLOCKED") "Pesan tidak terkirim karena ada blokir." else error.message
                else -> error.message
            },
        )
    }

    fun shareLocation(lat: Double, lng: Double) {
        val convoyId = uiState.convoyId ?: return
        val clientId = UUID.randomUUID().toString()
        viewModelScope.launch {
            chat.send(
                convoyId,
                SendMessageRequest(clientMessageId = clientId, kind = "location", lat = lat, lng = lng),
            ).fold(
                onSuccess = { saved -> uiState = uiState.copy(messages = uiState.messages + saved) },
                onFailure = { error -> uiState = uiState.copy(error = error.message) },
            )
        }
    }

    fun dismissNotice() {
        uiState = uiState.copy(notice = null, error = null)
    }
}
