package id.riderjourney.app.data

import id.riderjourney.app.data.api.RiderJourneyApi
import id.riderjourney.app.data.api.StartTripRequest
import id.riderjourney.app.data.api.TripDto
import kotlinx.serialization.json.Json
import java.time.Instant

import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TripRepository @Inject constructor(
    private val api: RiderJourneyApi,
    private val recorder: TripRecorder,
    private val json: Json,
) {
    suspend fun active(): Result<TripDto?> = apiCall(json) {
        val trip = api.activeTrip().trip
        if (trip != null) {
            val started = runCatching { Instant.parse(trip.startedAt).toEpochMilli() }.getOrDefault(System.currentTimeMillis())
            recorder.attach(trip.id, started, trip.status, trip.pointCount)
        } else {
            recorder.clearLocal()
        }
        trip
    }

    suspend fun history(): Result<List<TripDto>> = apiCall(json) { api.trips().items }

    suspend fun start(vehicleId: String?): Result<TripDto> = apiCall(json) {
        val trip = api.startTrip(StartTripRequest(vehicleId = vehicleId))
        val started = runCatching { Instant.parse(trip.startedAt).toEpochMilli() }.getOrDefault(System.currentTimeMillis())
        recorder.attach(trip.id, started, trip.status)
        trip
    }

    suspend fun pause(id: String): Result<TripDto> = apiCall(json) {
        api.pauseTrip(id).also { recorder.updateStatus(it.status) }
    }

    suspend fun resume(id: String): Result<TripDto> = apiCall(json) {
        api.resumeTrip(id).also { recorder.updateStatus(it.status) }
    }

    suspend fun finish(id: String): Result<TripDto> = apiCall(json) {
        if (!recorder.flush()) throw ApiException("POINTS_PENDING", "Titik GPS belum terkirim. Coba lagi saat online.")
        val trip = api.finishTrip(id)
        recorder.clearLocal()
        trip
    }

    suspend fun flush(): Boolean = recorder.flush()

    suspend fun syncAfterProcessDeath(): TripDto? {
        val trip = active().getOrNull() ?: return null
        if (trip.status == "active") recorder.flush()
        return trip
    }
}
