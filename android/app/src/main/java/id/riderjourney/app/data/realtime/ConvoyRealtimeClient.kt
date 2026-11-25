package id.riderjourney.app.data.realtime

import id.riderjourney.app.data.ApiException
import id.riderjourney.app.data.api.ConvoyLocationMessage
import id.riderjourney.app.data.api.ConvoyLocationPayload
import id.riderjourney.app.data.api.RealtimeEnvelopeDto
import id.riderjourney.app.data.api.RealtimeTicketDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.net.URLEncoder
import java.time.Instant
import kotlin.math.min
import kotlin.random.Random

/**
 * Satu koneksi realtime per konvoi. Tiket selalu diminta ulang saat reconnect,
 * sedangkan sinceSeq dipertahankan agar server memutar ulang event yang terlewat.
 */
class ConvoyRealtimeClient(
    private val ticketProvider: suspend (String) -> Result<RealtimeTicketDto>,
    private val baseUrl: String,
    private val json: Json,
    private val http: OkHttpClient,
    private val scope: CoroutineScope,
    private val onEvent: (RealtimeEnvelopeDto) -> Unit,
    private val onStatus: (String) -> Unit,
) {
    private var socket: WebSocket? = null
    private var convoyId: String? = null
    private var lastSeq = 0
    private var clientSeq = 0
    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private var pingJob: Job? = null
    private var closedByUser = false
    private var connecting = false
    private var open = false
    private val seen = LinkedHashSet<String>()

    fun connect(id: String) {
        if (convoyId != id) {
            lastSeq = 0
            clientSeq = 0
            seen.clear()
            convoyId = id
            open = false
            socket?.close(1000, "switch_convoy")
            socket = null
        }
        if (open) {
            onStatus("connected")
            return
        }
        closedByUser = false
        open()
    }

    fun reconnectNow() {
        if (convoyId == null) return
        closedByUser = false
        reconnectJob?.cancel()
        open()
    }

    fun disconnect() {
        closedByUser = true
        reconnectJob?.cancel()
        pingJob?.cancel()
        connecting = false
        open = false
        socket?.close(1000, "client_closed")
        socket = null
        onStatus("disconnected")
    }

    fun sendLocation(lat: Double, lng: Double, accuracyM: Double, headingDeg: Double?, speedMps: Double?, recordedAtMs: Long): Boolean {
        val ws = socket ?: return false
        val payload = ConvoyLocationPayload(
            lat = lat,
            lng = lng,
            accuracyM = accuracyM,
            headingDeg = headingDeg,
            speedMps = speedMps,
            recordedAt = Instant.ofEpochMilli(recordedAtMs).toString(),
            clientSeq = ++clientSeq,
        )
        return ws.send(json.encodeToString(ConvoyLocationMessage.serializer(), ConvoyLocationMessage(data = payload)))
    }

    private fun open() {
        val id = convoyId ?: return
        if (closedByUser || connecting || open) return
        connecting = true
        onStatus("connecting")
        scope.launch {
            val ticket = ticketProvider(id).getOrElse { error ->
                connecting = false
                onStatus("error")
                val code = (error as? ApiException)?.code
                if (code in setOf("UNAUTHENTICATED", "CONVOY_ACCESS_DENIED", "CONVOY_NOT_LIVE")) onStatus("denied") else scheduleReconnect()
                return@launch
            }
            val wsUrl = buildString {
                append(baseUrl.trimEnd('/').replaceFirst("https://", "wss://").replaceFirst("http://", "ws://"))
                append("/v1/realtime?ticket=")
                append(URLEncoder.encode(ticket.ticket, "UTF-8"))
                append("&sinceSeq=")
                append(lastSeq)
            }
            socket?.close(1000, "replace")
            socket = http.newWebSocket(
                Request.Builder().url(wsUrl).build(),
                listener(),
            )
        }
    }

    private fun listener() = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            connecting = false
            open = true
            reconnectAttempt = 0
            socket = webSocket
            onStatus("connected")
            startPing(webSocket)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val event = runCatching { json.decodeFromString(RealtimeEnvelopeDto.serializer(), text) }.getOrNull() ?: return
            if (!accept(event)) return
            onEvent(event)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            connecting = false
            open = false
            pingJob?.cancel()
            socket = null
            if (code in setOf(4001, 4003, 4008)) {
                onStatus("denied")
                return
            }
            if (!closedByUser) scheduleReconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            connecting = false
            open = false
            pingJob?.cancel()
            socket = null
            if (!closedByUser) {
                onStatus("offline")
                scheduleReconnect()
            }
        }
    }

    private fun accept(event: RealtimeEnvelopeDto): Boolean {
        if (event.type == "convoy.ready") return false
        if (event.id.isNotBlank() && !seen.add(event.id)) return false
        if (event.type != "convoy.snapshot" && event.seq > 0 && event.seq <= lastSeq) return false
        if (event.seq > lastSeq) lastSeq = event.seq
        if (seen.size > 500) {
            val iterator = seen.iterator()
            repeat(seen.size - 400) {
                if (iterator.hasNext()) {
                    iterator.next()
                    iterator.remove()
                }
            }
        }
        return true
    }

    private fun scheduleReconnect() {
        if (closedByUser) return
        if (reconnectJob?.isActive == true) return
        reconnectAttempt += 1
        val backoff = min(30_000L, (1L shl min(reconnectAttempt, 5)) * 1000L)
        val delayMs = backoff + Random.nextLong(0, 500)
        onStatus("reconnecting")
        reconnectJob = scope.launch {
            delay(delayMs)
            if (isActive) open()
        }
    }

    private fun startPing(webSocket: WebSocket) {
        pingJob?.cancel()
        pingJob = scope.launch(Dispatchers.IO) {
            while (isActive) {
                delay(25_000)
                if (!webSocket.send("""{"type":"ping"}""")) break
            }
        }
    }
}
