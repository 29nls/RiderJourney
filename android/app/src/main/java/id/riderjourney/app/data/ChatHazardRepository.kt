package id.riderjourney.app.data

import id.riderjourney.app.data.api.CreateHazardRequest
import id.riderjourney.app.data.api.ConfirmHazardRequest
import id.riderjourney.app.data.api.HazardConfirmDto
import id.riderjourney.app.data.api.HazardDto
import id.riderjourney.app.data.api.HazardListDto
import id.riderjourney.app.data.api.HazardReportRequest
import id.riderjourney.app.data.api.MessageDto
import id.riderjourney.app.data.api.MessagePageDto
import id.riderjourney.app.data.api.RiderJourneyApi
import id.riderjourney.app.data.api.SendMessageRequest
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepository @Inject constructor(
    private val api: RiderJourneyApi,
    private val json: Json,
) {
    suspend fun page(convoyId: String, before: String? = null, limit: Int = 20): Result<MessagePageDto> =
        apiCall(json) { api.convoyMessages(convoyId, limit, before) }

    suspend fun send(convoyId: String, request: SendMessageRequest): Result<MessageDto> =
        apiCall(json) { api.sendConvoyMessage(convoyId, request) }
}

@Singleton
class HazardRepository @Inject constructor(
    private val api: RiderJourneyApi,
    private val json: Json,
) {
    suspend fun nearby(lat: Double, lng: Double): Result<HazardListDto> =
        apiCall(json) { api.nearbyHazards(lat, lng) }

    suspend fun create(request: CreateHazardRequest): Result<HazardDto> =
        apiCall(json) { api.createHazard(request) }

    suspend fun confirm(id: String, verdict: String): Result<HazardConfirmDto> =
        apiCall(json) { api.confirmHazard(id, ConfirmHazardRequest(verdict)) }

    suspend fun report(id: String, reason: String): Result<Unit> = apiCall(json) {
        api.reportHazard(id, HazardReportRequest(reason))
        Unit
    }
}
