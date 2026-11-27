package id.riderjourney.app.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonElement

@Serializable
data class RegisterRequest(
    val email: String,
    val username: String,
    val displayName: String,
    val password: String,
)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class ResetRequest(val email: String)

@Serializable
data class ResetConfirmRequest(val token: String, val newPassword: String)

@Serializable
data class AuthResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
    val user: UserDto,
    val verificationToken: String? = null,
)

@Serializable
data class RefreshResponse(val accessToken: String, val refreshToken: String, val expiresIn: Int)

@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val username: String,
    val displayName: String,
    val bio: String? = null,
    val city: String? = null,
    val avatarUrl: String? = null,
    val avatarMediaId: String? = null,
    val visibility: String,
    val status: String,
    val emailVerified: Boolean,
    val createdAt: String,
)

@Serializable
data class SettingsDto(
    val locationSharingDefault: Boolean = false,
    val tripHistoryVisibility: String = "private",
    val notificationPreferences: JsonObject? = null,
    val audioPreferences: JsonObject? = null,
    val mapPreferences: JsonObject? = null,
)

@Serializable
data class MeDto(
    val id: String,
    val email: String,
    val username: String,
    val displayName: String,
    val bio: String? = null,
    val city: String? = null,
    val avatarUrl: String? = null,
    val avatarMediaId: String? = null,
    val visibility: String = "public",
    val status: String = "active",
    val emailVerified: Boolean = false,
    val createdAt: String,
    val settings: SettingsDto? = null,
    val activeTripId: String? = null,
)

@Serializable
data class UpdateProfileRequest(
    val displayName: String? = null,
    val bio: String? = null,
    val city: String? = null,
    val avatarUrl: String? = null,
    val avatarMediaId: String? = null,
    val visibility: String? = null,
)

@Serializable
data class UpdateSettingsRequest(
    val locationSharingDefault: Boolean? = null,
    val tripHistoryVisibility: String? = null,
)

@Serializable
data class VehicleDto(
    val id: String,
    val type: String,
    val brand: String,
    val model: String,
    val year: Int? = null,
    val engineCc: Int? = null,
    val nickname: String? = null,
    val photoUrl: String? = null,
    val photoMediaId: String? = null,
    val isPrimary: Boolean = false,
    val hasPlate: Boolean = false,
    val plate: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class VehicleListDto(val items: List<VehicleDto> = emptyList())

@Serializable
data class VehicleRequest(
    val type: String,
    val brand: String,
    val model: String,
    val year: Int? = null,
    val engineCc: Int? = null,
    val nickname: String? = null,
    val plate: String? = null,
    val photoMediaId: String? = null,
)

@Serializable
data class PlaceDto(
    val providerRef: String? = null,
    val name: String,
    val category: String? = null,
    val location: LatLngDto,
)

@Serializable
data class LatLngDto(val lat: Double, val lng: Double)

@Serializable
data class PlaceListDto(val items: List<PlaceDto> = emptyList(), val provider: String? = null)

@Serializable
data class WaypointDto(val lat: Double, val lng: Double, val label: String? = null)

@Serializable
data class RoutePreviewRequest(
    val origin: LatLngDto,
    val destination: LatLngDto,
    val waypoints: List<WaypointDto> = emptyList(),
    val alternatives: Boolean = true,
)

@Serializable
data class RouteLineDto(val type: String, val coordinates: List<List<Double>> = emptyList())

@Serializable
data class RouteOptionDto(
    val id: String,
    val distanceM: Int,
    val durationS: Int,
    val geometry: RouteLineDto,
    val provider: String,
    val disclaimer: String,
)

@Serializable
data class RouteDetailDto(
    val id: String,
    val ownerId: String? = null,
    val name: String? = null,
    val distanceM: Int,
    val durationS: Int,
    val provider: String,
    val waypoints: List<WaypointDto> = emptyList(),
    val geometry: RouteLineDto,
)

@Serializable
data class RoutePreviewResponse(
    val routes: List<RouteOptionDto> = emptyList(),
    val providerStatus: String,
    val disclaimer: String? = null,
)

@Serializable
data class StartTripRequest(val vehicleId: String? = null, val routeId: String? = null)

@Serializable
data class TripDto(
    val id: String,
    val vehicleId: String? = null,
    val routeId: String? = null,
    val status: String,
    val startedAt: String,
    val endedAt: String? = null,
    val durationS: Int = 0,
    val distanceM: Int = 0,
    val movingS: Int = 0,
    val avgSpeedKph: Double? = null,
    val maxSpeedKph: Double? = null,
    val startLocation: LatLngDto? = null,
    val endLocation: LatLngDto? = null,
    val pointCount: Int = 0,
    val dataQuality: JsonObject? = null,
    val createdAt: String,
)

@Serializable
data class TripListDto(val items: List<TripDto> = emptyList(), val nextCursor: String? = null)

@Serializable
data class ActiveTripDto(val trip: TripDto? = null)

@Serializable
data class TripPointRequest(
    val seq: Int,
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val speedMps: Double? = null,
    val headingDeg: Double? = null,
    val recordedAt: String,
)

@Serializable
data class TripPointsRequest(val points: List<TripPointRequest>)

@Serializable
data class RejectedPointDto(val seq: Int, val code: String)

@Serializable
data class TripPointsResponse(
    val accepted: Int = 0,
    val duplicates: Int = 0,
    val rejected: List<RejectedPointDto> = emptyList(),
)

@Serializable
data class TripPointDto(
    val seq: Int,
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val speedMps: Double? = null,
    val headingDeg: Double? = null,
    val recordedAt: String,
    val quality: String,
)

@Serializable
data class TripPointListDto(val items: List<TripPointDto> = emptyList(), val nextCursor: Int? = null)

@Serializable
data class ConvoyDto(
    val id: String,
    val leaderId: String,
    val name: String,
    val meetingPoint: LatLngDto,
    val destination: LatLngDto,
    val waypoints: List<WaypointDto> = emptyList(),
    val scheduledAt: String? = null,
    val capacity: Int,
    val status: String,
    val routeId: String? = null,
    val routeVersion: Int = 0,
    val version: Int = 1,
    val activeMemberCount: Int = 0,
    val role: String? = null,
    val membershipStatus: String? = null,
    val sharingConsent: Boolean? = null,
    val startedAt: String? = null,
    val pausedAt: String? = null,
    val completedAt: String? = null,
    val cancelledAt: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val inviteCode: String? = null,
    val inviteLink: String? = null,
    val inviteExpiresAt: String? = null,
)

@Serializable
data class ActiveConvoyDto(val convoy: ConvoyDto? = null)

@Serializable
data class ConvoyListDto(val items: List<ConvoyDto> = emptyList())

@Serializable
data class ConvoyCreateRequest(
    val name: String,
    val meetingPoint: LatLngDto,
    val destination: LatLngDto,
    val waypoints: List<WaypointDto> = emptyList(),
    val scheduledAt: String? = null,
    val capacity: Int? = null,
    val routeId: String? = null,
)

@Serializable
data class ConvoyJoinRequest(val code: String)

@Serializable
data class ConvoyMemberDto(
    val userId: String,
    val displayName: String,
    val username: String,
    val avatarUrl: String? = null,
    val role: String,
    val status: String,
    val sharingConsent: Boolean = false,
    val presence: String? = null,
    val locationStatus: String? = null,
    val joinedAt: String? = null,
    val lastSeenAt: String? = null,
)

@Serializable
data class ConvoyMemberListDto(val items: List<ConvoyMemberDto> = emptyList())

@Serializable
data class ConvoyPositionDto(
    val userId: String,
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val headingDeg: Double? = null,
    val speedMps: Double? = null,
    val recordedAt: String,
    val lastSeenAt: String? = null,
    val stale: Boolean = false,
    val ageSeconds: Int = 0,
)

@Serializable
data class ConvoyPositionListDto(val items: List<ConvoyPositionDto> = emptyList(), val serverTime: String? = null)

@Serializable
data class ConvoyInviteDto(
    val id: String? = null,
    val code: String,
    val link: String? = null,
    val expiresAt: String? = null,
    val maxUses: Int = 1,
    val usedCount: Int = 0,
    val revokedAt: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class ConvoyInviteListDto(val items: List<ConvoyInviteDto> = emptyList())

@Serializable
data class ConvoyCreateInviteRequest(val maxUses: Int? = null, val expiresInSeconds: Int? = null)

@Serializable
data class ConvoySharingRequest(val sharingConsent: Boolean)

@Serializable
data class ConvoyRouteRequest(val routeId: String)

@Serializable
data class ConvoyRoleRequest(val role: String)

@Serializable
data class ConvoyTransferRequest(val userId: String)

@Serializable
data class RealtimeTicketRequest(val convoyId: String)

@Serializable
data class RealtimeTicketDto(
    val ticket: String,
    val expiresIn: Int = 60,
    val convoyId: String,
    val protocol: String = "v1",
    val wsPath: String = "/v1/realtime",
    val capabilities: RealtimeCapabilitiesDto? = null,
)

@Serializable
data class RealtimeCapabilitiesDto(val subscribe: Boolean = true, val publishLocation: Boolean = false)

@Serializable
data class RealtimeEnvelopeDto(
    val v: Int = 1,
    val id: String = "",
    val type: String,
    val room: String? = null,
    val seq: Int = 0,
    val ts: String = "",
    val data: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class ConvoySnapshotDto(
    val convoyId: String,
    val status: String,
    val version: Int,
    val role: String,
    val sharingConsent: Boolean = false,
    val members: List<ConvoyMemberDto> = emptyList(),
    val positions: List<ConvoyPositionDto> = emptyList(),
    val routeId: String? = null,
    val routeVersion: Int = 0,
    val lastSeq: Int = 0,
    val serverTime: String? = null,
    val replayTruncated: Boolean = false,
)

@Serializable
data class ConvoyLocationEventDto(
    val convoyId: String? = null,
    val userId: String,
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val headingDeg: Double? = null,
    val speedMps: Double? = null,
    val recordedAt: String,
    val stale: Boolean = false,
)

@Serializable
data class ConvoyMemberEventDto(
    val convoyId: String? = null,
    val userId: String,
    val role: String? = null,
    val status: String? = null,
    val sharingConsent: Boolean? = null,
    val reason: String? = null,
    val version: Int = 0,
)

@Serializable
data class ConvoyStatusEventDto(val convoyId: String? = null, val status: String, val actorId: String? = null, val version: Int = 0)

@Serializable
data class ConvoyRouteEventDto(val convoyId: String? = null, val routeId: String, val routeVersion: Int, val changedBy: String? = null, val version: Int = 0)

@Serializable
data class ConvoyStaleEventDto(val convoyId: String? = null, val userId: String, val lastSeenAt: String? = null, val stale: Boolean = true, val reason: String? = null)

@Serializable
data class RealtimeErrorDto(val code: String, val detail: String? = null)

@Serializable
data class LocationUpdateAck(val accepted: Boolean = false, val code: String? = null)

@Serializable
data class ConvoyLocationPayload(
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val headingDeg: Double? = null,
    val speedMps: Double? = null,
    val recordedAt: String,
    val clientSeq: Int,
)

@Serializable
data class ConvoyLocationMessage(val type: String = "convoy.location.updated", val data: ConvoyLocationPayload)

