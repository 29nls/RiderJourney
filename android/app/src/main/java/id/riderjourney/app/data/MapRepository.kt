package id.riderjourney.app.data

import id.riderjourney.app.data.api.PlaceDto
import id.riderjourney.app.data.api.RiderJourneyApi
import id.riderjourney.app.data.api.RouteOptionDto
import id.riderjourney.app.data.api.RoutePreviewRequest
import id.riderjourney.app.data.api.RoutePreviewResponse
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MapRepository @Inject constructor(
    private val api: RiderJourneyApi,
    private val json: Json,
) {
    suspend fun searchPlaces(query: String): Result<List<PlaceDto>> = apiCall(json) { api.searchPlaces(query).items }

    suspend fun previewRoute(request: RoutePreviewRequest): Result<RoutePreviewResponse> =
        apiCall(json) { api.previewRoute(request) }

    suspend fun recalculateRoute(id: String): Result<RouteOptionDto> =
        apiCall(json) { api.recalculateRoute(id) }
}
