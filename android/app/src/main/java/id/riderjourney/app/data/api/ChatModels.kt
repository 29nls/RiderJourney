package id.riderjourney.app.data.api

import kotlinx.serialization.Serializable

@Serializable
data class MessageSenderDto(
    val id: String,
    val displayName: String = "",
    val username: String = "",
)

@Serializable
data class MessageLocationDto(val lat: Double, val lng: Double)

@Serializable
data class MessageDto(
    val id: String,
    val convoyId: String = "",
    val clientMessageId: String = "",
    val sender: MessageSenderDto,
    val kind: String = "text",
    val body: String? = null,
    val location: MessageLocationDto? = null,
    val label: String? = null,
    val deliveryState: String = "sent",
    val createdAt: String = "",
)

@Serializable
data class MessagePageDto(
    val items: List<MessageDto> = emptyList(),
    val nextCursor: String? = null,
)

@Serializable
data class SendMessageRequest(
    val clientMessageId: String,
    val kind: String = "text",
    val body: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val label: String? = null,
)
