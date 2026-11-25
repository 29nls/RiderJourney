package id.riderjourney.app.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import id.riderjourney.app.BuildConfig
import id.riderjourney.app.data.ApiException
import id.riderjourney.app.data.ConvoyRepository
import id.riderjourney.app.data.api.ConvoyCreateRequest
import id.riderjourney.app.data.api.ConvoyDto
import id.riderjourney.app.data.api.ConvoyInviteDto
import id.riderjourney.app.data.api.ConvoyLocationEventDto
import id.riderjourney.app.data.api.ConvoyMemberDto
import id.riderjourney.app.data.api.ConvoyPositionDto
import id.riderjourney.app.data.api.ConvoyRouteEventDto
import id.riderjourney.app.data.api.ConvoySnapshotDto
import id.riderjourney.app.data.api.ConvoyStaleEventDto
import id.riderjourney.app.data.api.ConvoyStatusEventDto
import id.riderjourney.app.data.api.LatLngDto
import id.riderjourney.app.data.api.RealtimeEnvelopeDto
import id.riderjourney.app.data.api.RealtimeErrorDto
import id.riderjourney.app.data.api.RouteDetailDto
import id.riderjourney.app.data.api.WaypointDto
import id.riderjourney.app.data.realtime.ConvoyRealtimeClient
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import okhttp3.OkHttpClient
import java.time.Instant
import java.time.OffsetDateTime
import javax.inject.Inject

data class ConvoyUiState(
    val convoy: ConvoyDto? = null,
    val members: List<ConvoyMemberDto> = emptyList(),
    val positions: List<ConvoyPositionDto> = emptyList(),
    val route: RouteDetailDto? = null,
    val invite: ConvoyInviteDto? = null,
    val loading: Boolean = false,
    val busy: Boolean = false,
    val connection: String = "idle",
    val error: String? = null,
    val notice: String? = null,
)

private data class LocalFix(
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val headingDeg: Double?,
    val speedMps: Double?,
    val recordedAtMs: Long,
)

@HiltViewModel
class ConvoyViewModel @Inject constructor(
    private val convoys: ConvoyRepository,
    private val json: Json,
    private val http: OkHttpClient,
    @ApplicationContext private val context: Context,
) : ViewModel() {
    var uiState by mutableStateOf(ConvoyUiState())
        private set

    private val fused: FusedLocationProviderClient by lazy { LocationServices.getFusedLocationProviderClient(context) }
    private var streaming = false
    private var latestFix: LocalFix? = null

    private val realtime = ConvoyRealtimeClient(
        ticketProvider = { convoyId -> convoys.ticket(convoyId) },
        baseUrl = BuildConfig.API_BASE_URL,
        json = json,
        http = http,
        scope = viewModelScope,
        onEvent = { event -> viewModelScope.launch { handleEvent(event) } },
        onStatus = { status -> viewModelScope.launch { handleConnection(status) } },
    )

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            latestFix = location.toFix()
            latestFix?.let(::publishFix)
        }
    }

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            uiState = uiState.copy(loading = true, error = null)
            convoys.active().fold(
                onSuccess = { convoy ->
                    if (convoy == null) {
                        val keepEnded = uiState.convoy?.status in setOf("completed", "cancelled")
                        uiState = uiState.copy(loading = false, convoy = if (keepEnded) uiState.convoy else null, route = null)
                        if (!keepEnded) {
                            realtime.disconnect()
                            stopStreaming()
                        }
                    } else {
                        uiState = uiState.copy(loading = false, convoy = convoy)
                        loadMembersAndPositions(convoy.id)
                        loadRoute(convoy)
                        syncRealtime(convoy)
                    }
                },
                onFailure = { error ->
                    uiState = uiState.copy(loading = false, error = error.message)
                },
            )
        }
    }

    private fun syncRealtime(convoy: ConvoyDto) {
        if (convoy.membershipStatus != "active" || convoy.status !in setOf("lobby", "active", "paused")) {
            realtime.disconnect()
            stopStreaming()
            return
        }
        realtime.connect(convoy.id)
        if (convoy.status == "active" && convoy.sharingConsent == true) startStreamingIfPermitted() else stopStreaming()
    }

    private fun loadMembersAndPositions(convoyId: String) {
        viewModelScope.launch {
            convoys.members(convoyId).onSuccess { members ->
                uiState = uiState.copy(members = members)
            }
            convoys.positions(convoyId).onSuccess { positions ->
                uiState = uiState.copy(positions = positions.items)
            }
        }
    }

    private fun loadRoute(convoy: ConvoyDto) {
        val routeId = convoy.routeId
        if (routeId == null || convoy.membershipStatus != "active" || convoy.status !in setOf("lobby", "active", "paused")) {
            uiState = uiState.copy(route = null)
            return
        }
        viewModelScope.launch {
            convoys.route(routeId).fold(
                onSuccess = { route ->
                    if (uiState.convoy?.routeId == routeId) uiState = uiState.copy(route = route)
                },
                onFailure = {
                    if (uiState.convoy?.routeId == routeId) uiState = uiState.copy(route = null)
                },
            )
        }
    }

    fun create(
        name: String,
        meetingLat: String,
        meetingLng: String,
        destinationLat: String,
        destinationLng: String,
        capacity: String,
        scheduledAt: String,
        routeId: String,
        waypointText: String,
    ) {
        val meet = parsePoint(meetingLat, meetingLng)
        val destination = parsePoint(destinationLat, destinationLng)
        if (name.trim().length < 3) {
            uiState = uiState.copy(error = "Nama konvoi minimal 3 karakter.")
            return
        }
        if (meet == null || destination == null) {
            uiState = uiState.copy(error = "Koordinat titik kumpul dan tujuan harus valid.")
            return
        }
        val waypoints = parseWaypoints(waypointText)
        if (waypoints == null) {
            uiState = uiState.copy(error = "Waypoint harus berformat lat,lng,label dan maksimal 7 titik.")
            return
        }
        val scheduled = scheduledAt.trim().ifBlank { null }
        if (scheduled != null && runCatching { OffsetDateTime.parse(scheduled) }.isFailure) {
            uiState = uiState.copy(error = "Waktu konvoi harus memakai format ISO 8601, misalnya 2026-11-25T08:00:00+07:00.")
            return
        }
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            convoys.create(
                ConvoyCreateRequest(
                    name = name.trim(),
                    meetingPoint = meet,
                    destination = destination,
                    waypoints = waypoints,
                    scheduledAt = scheduled,
                    capacity = capacity.toIntOrNull()?.coerceAtLeast(2),
                    routeId = routeId.trim().ifBlank { null },
                ),
            ).fold(
                onSuccess = { convoy ->
                    val invite = convoy.inviteCode?.let {
                        ConvoyInviteDto(code = it, link = convoy.inviteLink, expiresAt = convoy.inviteExpiresAt)
                    }
                    uiState = uiState.copy(
                        busy = false,
                        convoy = convoy,
                        route = null,
                        invite = invite,
                        notice = "Konvoi dibuat. Bagikan kode undangan hanya kepada anggota yang dipercaya.",
                    )
                    loadMembersAndPositions(convoy.id)
                    loadRoute(convoy)
                    syncRealtime(convoy)
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun join(code: String) {
        if (code.trim().length < 8) {
            uiState = uiState.copy(error = "Kode undangan tidak valid.")
            return
        }
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            convoys.join(code).fold(
                onSuccess = { convoy ->
                    uiState = uiState.copy(
                        busy = false,
                        convoy = convoy,
                        notice = if (convoy.membershipStatus == "requested") "Permintaan bergabung dikirim. Tunggu persetujuan leader." else "Bergabung ke konvoi.",
                    )
                    loadMembersAndPositions(convoy.id)
                    syncRealtime(convoy)
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun createInvite() {
        val convoy = uiState.convoy ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            convoys.createInvite(convoy.id, maxUses = (convoy.capacity - 1).coerceAtLeast(1)).fold(
                onSuccess = { invite ->
                    uiState = uiState.copy(busy = false, invite = invite, notice = "Kode undangan baru dibuat dan hanya ditampilkan sekali.")
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun setSharing(enabled: Boolean) {
        val convoy = uiState.convoy ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            convoys.sharing(convoy.id, enabled).fold(
                onSuccess = {
                    uiState = uiState.copy(
                        busy = false,
                        convoy = convoy.copy(sharingConsent = enabled),
                        notice = if (enabled) "Berbagi lokasi aktif selama konvoi berjalan." else "Berbagi lokasi dimatikan dan posisi Anda dihapus.",
                    )
                    if (enabled) {
                        syncRealtime(convoy.copy(sharingConsent = true))
                    } else {
                        stopStreaming()
                    }
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun start() = transition("Konvoi dimulai.", convoys::start)

    fun pause() = transition("Konvoi dijeda. Pengiriman lokasi berhenti.", convoys::pause)

    fun resume() = transition("Konvoi dilanjutkan.", convoys::resume)

    fun complete() = finishConvoy("Konvoi selesai. Lokasi live sudah dihapus dari Redis.", "completed", convoys::complete)

    fun cancel() = finishConvoy("Konvoi dibatalkan. Lokasi live sudah dihapus.", "cancelled", convoys::cancel)

    private fun transition(message: String, action: suspend (String, Int) -> Result<Unit>) {
        val convoy = uiState.convoy ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            action(convoy.id, convoy.version).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = message)
                    refresh()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    private fun finishConvoy(message: String, targetStatus: String, action: suspend (String, Int) -> Result<Unit>) {
        val convoy = uiState.convoy ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            action(convoy.id, convoy.version).fold(
                onSuccess = {
                    realtime.disconnect()
                    stopStreaming()
                    uiState = uiState.copy(
                        busy = false,
                        convoy = convoy.copy(status = targetStatus),
                        notice = message,
                    )
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun leave() {
        val convoy = uiState.convoy ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            convoys.leave(convoy.id, convoy.version).fold(
                onSuccess = {
                    realtime.disconnect()
                    stopStreaming()
                    uiState = ConvoyUiState(notice = "Anda keluar dari konvoi.")
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun approve(userId: String) = memberAction(userId, convoys::approve, "Anggota disetujui.")
    fun reject(userId: String) = memberAction(userId, convoys::reject, "Permintaan ditolak.")
    fun remove(userId: String) = memberAction(userId, convoys::remove, "Anggota dikeluarkan.")

    private fun memberAction(userId: String, action: suspend (String, String, Int) -> Result<Unit>, message: String) {
        val convoy = uiState.convoy ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            action(convoy.id, userId, convoy.version).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = message)
                    refresh()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun makeCoLeader(userId: String) {
        val convoy = uiState.convoy ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            convoys.changeRole(convoy.id, userId, "co_leader", convoy.version).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = "Role co-leader diberikan.")
                    refresh()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun transferLeadership(userId: String) {
        val convoy = uiState.convoy ?: return
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            convoys.transfer(convoy.id, userId, convoy.version).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = "Kepemimpinan dialihkan.")
                    refresh()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun updateRoute(routeId: String) {
        val convoy = uiState.convoy ?: return
        if (routeId.isBlank()) {
            uiState = uiState.copy(error = "Masukkan ID rute yang tersimpan.")
            return
        }
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            convoys.route(convoy.id, routeId.trim(), convoy.version).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = "Rute konvoi diperbarui untuk semua anggota.")
                    refresh()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun retryRealtime() {
        val convoy = uiState.convoy ?: return
        if (convoy.membershipStatus == "active") realtime.reconnectNow()
    }

    fun reset() {
        realtime.disconnect()
        stopStreaming()
        uiState = ConvoyUiState()
        refresh()
    }

    fun onLocationPermissionGranted() {
        startStreamingIfPermitted()
    }

    private fun startStreamingIfPermitted() {
        val convoy = uiState.convoy ?: return
        if (streaming || convoy.status != "active" || convoy.sharingConsent != true) return
        val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!allowed) {
            uiState = uiState.copy(notice = "Izin lokasi presisi diperlukan untuk berbagi posisi live.")
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
            .setMinUpdateDistanceMeters(8f)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            fused.requestLocationUpdates(request, locationCallback, android.os.Looper.getMainLooper())
            streaming = true
            fused.lastLocation.addOnSuccessListener { location ->
                if (location != null) {
                    latestFix = location.toFix()
                    latestFix?.let(::publishFix)
                }
            }
        } catch (_: SecurityException) {
            uiState = uiState.copy(error = "Izin lokasi dicabut. Berbagi lokasi dihentikan.")
        }
    }

    private fun stopStreaming() {
        if (!streaming) return
        fused.removeLocationUpdates(locationCallback)
        streaming = false
    }

    private fun publishFix(fix: LocalFix) {
        val convoy = uiState.convoy ?: return
        if (convoy.status != "active" || convoy.sharingConsent != true) return
        realtime.sendLocation(
            lat = fix.lat,
            lng = fix.lng,
            accuracyM = fix.accuracyM,
            headingDeg = fix.headingDeg,
            speedMps = fix.speedMps,
            recordedAtMs = fix.recordedAtMs,
        )
    }

    private fun handleConnection(status: String) {
        uiState = uiState.copy(connection = status)
        if (status == "connected") {
            latestFix?.let(::publishFix)
        } else if (status == "denied") {
            uiState = uiState.copy(notice = "Akses realtime dicabut. Muat ulang konvoi atau hubungi leader.")
        }
    }

    private fun handleEvent(event: RealtimeEnvelopeDto) {
        when (event.type) {
            "convoy.snapshot" -> {
                val snapshot = decode<ConvoySnapshotDto>(event.data) ?: return
                val convoy = uiState.convoy
                if (convoy == null) {
                    refresh()
                    return
                }
                uiState = uiState.copy(
                    convoy = convoy.copy(
                        status = snapshot.status,
                        version = snapshot.version,
                        role = snapshot.role,
                        sharingConsent = snapshot.sharingConsent,
                        routeId = snapshot.routeId,
                        routeVersion = snapshot.routeVersion,
                        membershipStatus = "active",
                    ),
                    members = snapshot.members,
                    positions = snapshot.positions,
                )
                uiState.convoy?.let(::loadRoute)
                if (snapshot.status == "active" && snapshot.sharingConsent) startStreamingIfPermitted() else stopStreaming()
            }
            "convoy.location.updated" -> {
                val update = decode<ConvoyLocationEventDto>(event.data) ?: return
                val position = ConvoyPositionDto(
                    userId = update.userId,
                    lat = update.lat,
                    lng = update.lng,
                    accuracyM = update.accuracyM,
                    headingDeg = update.headingDeg,
                    speedMps = update.speedMps,
                    recordedAt = update.recordedAt,
                    lastSeenAt = Instant.now().toString(),
                    stale = false,
                )
                uiState = uiState.copy(
                    positions = uiState.positions.filterNot { it.userId == update.userId } + position,
                    members = uiState.members.map {
                        if (it.userId == update.userId) it.copy(presence = "online", locationStatus = "live") else it
                    },
                )
            }
            "convoy.location.stale" -> {
                val stale = decode<ConvoyStaleEventDto>(event.data) ?: return
                uiState = uiState.copy(
                    positions = uiState.positions.map {
                        if (it.userId == stale.userId) it.copy(stale = true, lastSeenAt = stale.lastSeenAt ?: it.lastSeenAt) else it
                    },
                    members = uiState.members.map {
                        when {
                            it.userId != stale.userId -> it
                            stale.reason == "sharing_disabled" -> it.copy(locationStatus = "not_sharing", sharingConsent = false)
                            else -> it.copy(locationStatus = "stale")
                        }
                    },
                )
            }
            "convoy.member.joined", "convoy.member.updated", "convoy.member.left" -> refresh()
            "convoy.status.changed" -> {
                val status = decode<ConvoyStatusEventDto>(event.data) ?: return
                val convoy = uiState.convoy ?: return
                uiState = uiState.copy(convoy = convoy.copy(status = status.status, version = status.version))
                if (status.status in setOf("completed", "cancelled")) {
                    realtime.disconnect()
                    stopStreaming()
                } else {
                    refresh()
                }
            }
            "convoy.route.updated" -> {
                val route = decode<ConvoyRouteEventDto>(event.data) ?: return
                val convoy = uiState.convoy ?: return
                uiState = uiState.copy(convoy = convoy.copy(routeId = route.routeId, routeVersion = route.routeVersion, version = route.version))
                uiState.convoy?.let(::loadRoute)
            }
            "error" -> {
                val error = decode<RealtimeErrorDto>(event.data) ?: return
                if (error.code !in setOf("RATE_LIMITED", "OUT_OF_ORDER")) {
                    uiState = uiState.copy(notice = error.detail ?: error.code)
                }
            }
        }
    }

    private inline fun <reified T> decode(element: JsonElement): T? =
        runCatching { json.decodeFromJsonElement<T>(element) }.getOrNull()

    private fun parsePoint(lat: String, lng: String): LatLngDto? {
        val parsedLat = lat.trim().toDoubleOrNull() ?: return null
        val parsedLng = lng.trim().toDoubleOrNull() ?: return null
        if (parsedLat !in -90.0..90.0 || parsedLng !in -180.0..180.0) return null
        return LatLngDto(parsedLat, parsedLng)
    }

    private fun parseWaypoints(value: String): List<WaypointDto>? {
        if (value.isBlank()) return emptyList()
        val parts = value.split(";").map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.size > 7) return null
        return parts.map { part ->
            val fields = part.split(",").map { it.trim() }
            if (fields.size < 2) return null
            val lat = fields[0].toDoubleOrNull() ?: return null
            val lng = fields[1].toDoubleOrNull() ?: return null
            if (lat !in -90.0..90.0 || lng !in -180.0..180.0) return null
            WaypointDto(lat, lng, fields.getOrNull(2)?.ifBlank { null })
        }
    }

    private fun Location.toFix() = LocalFix(
        lat = latitude,
        lng = longitude,
        accuracyM = if (hasAccuracy()) accuracy.toDouble() else 0.0,
        headingDeg = if (hasBearing()) bearing.toDouble() else null,
        speedMps = if (hasSpeed()) speed.toDouble() else null,
        recordedAtMs = time,
    )

    override fun onCleared() {
        realtime.disconnect()
        stopStreaming()
        super.onCleared()
    }
}
