package id.riderjourney.app.data.api

import kotlinx.serialization.Serializable

@Serializable
data class HazardReporterDto(
    val id: String,
    val displayName: String = "",
    val username: String = "",
)

@Serializable
data class HazardPointDto(val lat: Double, val lng: Double)

@Serializable
data class HazardDto(
    val id: String,
    val reporter: HazardReporterDto? = null,
    val kind: String = "other",
    val location: HazardPointDto,
    val note: String? = null,
    val photoMediaId: String? = null,
    val status: String = "active",
    val active: Boolean = false,
    val stale: Boolean = true,
    val moderationStatus: String = "visible",
    val createdAt: String = "",
    val expiresAt: String = "",
    val lastConfirmedAt: String? = null,
    val stillPresentCount: Int = 0,
    val notRelevantCount: Int = 0,
    val distanceM: Int? = null,
    val duplicateOfId: String? = null,
)

@Serializable
data class HazardListDto(
    val items: List<HazardDto> = emptyList(),
    val radiusM: Int = 3000,
    val serverTime: String = "",
)

@Serializable
data class CreateHazardRequest(
    val kind: String,
    val location: HazardPointDto,
    val observedAt: String,
    val note: String? = null,
    val ttlSeconds: Int? = null,
)

@Serializable
data class ConfirmHazardRequest(val verdict: String)

@Serializable
data class HazardConfirmDto(val hazard: HazardDto, val verdict: String)

@Serializable
data class HazardReportRequest(val reason: String, val note: String? = null)
