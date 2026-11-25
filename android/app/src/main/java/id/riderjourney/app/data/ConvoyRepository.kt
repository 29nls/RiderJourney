package id.riderjourney.app.data

import id.riderjourney.app.data.api.ActiveConvoyDto
import id.riderjourney.app.data.api.ConvoyCreateInviteRequest
import id.riderjourney.app.data.api.ConvoyCreateRequest
import id.riderjourney.app.data.api.ConvoyDto
import id.riderjourney.app.data.api.ConvoyInviteDto
import id.riderjourney.app.data.api.ConvoyInviteListDto
import id.riderjourney.app.data.api.ConvoyJoinRequest
import id.riderjourney.app.data.api.ConvoyListDto
import id.riderjourney.app.data.api.ConvoyMemberDto
import id.riderjourney.app.data.api.ConvoyMemberListDto
import id.riderjourney.app.data.api.ConvoyPositionListDto
import id.riderjourney.app.data.api.ConvoyRoleRequest
import id.riderjourney.app.data.api.ConvoyRouteRequest
import id.riderjourney.app.data.api.ConvoySharingRequest
import id.riderjourney.app.data.api.ConvoyTransferRequest
import id.riderjourney.app.data.api.RealtimeTicketDto
import id.riderjourney.app.data.api.RealtimeTicketRequest
import id.riderjourney.app.data.api.RouteDetailDto
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ConvoyRepository @Inject constructor(
    private val api: id.riderjourney.app.data.api.RiderJourneyApi,
    private val json: Json,
) {
    suspend fun active(): Result<ConvoyDto?> = apiCall(json) { api.activeConvoy().convoy }

    suspend fun list(): Result<List<ConvoyDto>> = apiCall(json) { api.convoys().items }

    suspend fun create(request: ConvoyCreateRequest): Result<ConvoyDto> = apiCall(json) { api.createConvoy(request) }

    suspend fun join(code: String): Result<ConvoyDto> = apiCall(json) { api.joinConvoy(ConvoyJoinRequest(code.trim().uppercase())) }

    suspend fun detail(id: String): Result<ConvoyDto> = apiCall(json) { api.convoy(id) }

    suspend fun members(id: String): Result<List<ConvoyMemberDto>> = apiCall(json) { api.convoyMembers(id).items }

    suspend fun positions(id: String): Result<ConvoyPositionListDto> = apiCall(json) { api.convoyPositions(id) }

    suspend fun route(id: String): Result<RouteDetailDto> = apiCall(json) { api.route(id) }

    suspend fun sharing(id: String, enabled: Boolean): Result<Unit> = apiCall(json) {
        api.convoySharing(id, ConvoySharingRequest(enabled))
        Unit
    }

    suspend fun start(id: String, version: Int): Result<Unit> = apiCall(json) {
        api.startConvoy(id, version.toString())
        Unit
    }

    suspend fun pause(id: String, version: Int): Result<Unit> = apiCall(json) {
        api.pauseConvoy(id, version.toString())
        Unit
    }

    suspend fun resume(id: String, version: Int): Result<Unit> = apiCall(json) {
        api.resumeConvoy(id, version.toString())
        Unit
    }

    suspend fun complete(id: String, version: Int): Result<Unit> = apiCall(json) {
        api.completeConvoy(id, version.toString())
        Unit
    }

    suspend fun cancel(id: String, version: Int): Result<Unit> = apiCall(json) {
        api.cancelConvoy(id, version.toString())
        Unit
    }

    suspend fun leave(id: String, version: Int): Result<Unit> = apiCall(json) {
        api.leaveConvoy(id, version.toString())
        Unit
    }

    suspend fun approve(id: String, userId: String, version: Int): Result<Unit> = apiCall(json) {
        api.approveConvoyMember(id, userId, version.toString())
        Unit
    }

    suspend fun reject(id: String, userId: String, version: Int): Result<Unit> = apiCall(json) {
        api.rejectConvoyMember(id, userId, version.toString())
        Unit
    }

    suspend fun remove(id: String, userId: String, version: Int): Result<Unit> = apiCall(json) {
        api.removeConvoyMember(id, userId, version.toString())
        Unit
    }

    suspend fun changeRole(id: String, userId: String, role: String, version: Int): Result<Unit> = apiCall(json) {
        api.changeConvoyRole(id, userId, ConvoyRoleRequest(role), version.toString())
        Unit
    }

    suspend fun transfer(id: String, userId: String, version: Int): Result<Unit> = apiCall(json) {
        api.transferConvoy(id, ConvoyTransferRequest(userId), version.toString())
        Unit
    }

    suspend fun route(id: String, routeId: String, version: Int): Result<Unit> = apiCall(json) {
        api.updateConvoyRoute(id, ConvoyRouteRequest(routeId), version.toString())
        Unit
    }

    suspend fun createInvite(id: String, maxUses: Int): Result<ConvoyInviteDto> =
        apiCall(json) { api.createConvoyInvite(id, ConvoyCreateInviteRequest(maxUses = maxUses)) }

    suspend fun invites(id: String): Result<List<ConvoyInviteDto>> = apiCall(json) { api.convoyInvites(id).items }

    suspend fun revokeInvite(id: String, inviteId: String): Result<Unit> = apiCall(json) {
        api.revokeConvoyInvite(id, inviteId)
        Unit
    }

    suspend fun ticket(convoyId: String): Result<RealtimeTicketDto> = apiCall(json) {
        api.realtimeTicket(RealtimeTicketRequest(convoyId))
    }
}
