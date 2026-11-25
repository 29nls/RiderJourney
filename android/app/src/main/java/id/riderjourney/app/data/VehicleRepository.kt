package id.riderjourney.app.data

import id.riderjourney.app.data.api.RiderJourneyApi
import id.riderjourney.app.data.api.VehicleDto
import id.riderjourney.app.data.api.VehicleRequest
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VehicleRepository @Inject constructor(
    private val api: RiderJourneyApi,
    private val json: Json,
) {
    suspend fun list(): Result<List<VehicleDto>> = apiCall(json) { api.vehicles().items }

    suspend fun create(request: VehicleRequest): Result<VehicleDto> = apiCall(json) { api.createVehicle(request) }

    suspend fun update(id: String, request: VehicleRequest): Result<VehicleDto> = apiCall(json) { api.updateVehicle(id, request) }

    suspend fun delete(id: String): Result<Unit> = apiCall(json) { api.deleteVehicle(id) }

    suspend fun setPrimary(id: String): Result<VehicleDto> = apiCall(json) { api.primaryVehicle(id) }

    suspend fun detail(id: String, includePlate: Boolean): Result<VehicleDto> = apiCall(json) { api.vehicle(id, includePlate) }
}
