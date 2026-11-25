package id.riderjourney.app.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import id.riderjourney.app.data.api.RiderJourneyApi
import id.riderjourney.app.data.api.TripPointRequest
import id.riderjourney.app.data.api.TripPointsRequest
import id.riderjourney.app.data.local.PendingPointEntity
import id.riderjourney.app.data.local.TripDao
import id.riderjourney.app.data.local.TripSessionEntity
import id.riderjourney.app.domain.FixQuality
import id.riderjourney.app.domain.GpsFilter
import id.riderjourney.app.domain.RawFix
import id.riderjourney.app.work.TripSyncWorker
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TripRecorder @Inject constructor(
    private val dao: TripDao,
    private val api: RiderJourneyApi,
    private val json: Json,
    @ApplicationContext private val context: Context,
) {
    // Location callbacks can arrive in parallel; serialize sequence allocation and
    // keep the last accepted fix in memory so flushes do not blind the spike filter.
    private val writeMutex = Mutex()
    private val lastAccepted = mutableMapOf<String, RawFix>()

    suspend fun attach(tripId: String, startedAtMs: Long, status: String, minSeq: Int = 0) {
        writeMutex.withLock {
            val existing = dao.session()
            if (existing != null && existing.tripId != tripId) lastAccepted.remove(existing.tripId)
            val seq = if (existing?.tripId == tripId) maxOf(existing.lastSeq, minSeq) else minSeq
            dao.saveSession(TripSessionEntity(tripId, startedAtMs, status, seq))
            TripSyncWorker.schedule(context)
        }
    }

    suspend fun activeSession(): TripSessionEntity? = dao.session()

    suspend fun updateStatus(status: String) {
        dao.session()?.let { dao.updateStatus(it.tripId, status) }
    }

    suspend fun record(tripId: String, fix: RawFix): FixQuality? = writeMutex.withLock {
        val session = dao.session() ?: return@withLock null
        if (session.tripId != tripId || session.status != "active") return@withLock null
        val stored = dao.latestPoint(tripId)?.let {
            RawFix(it.lat, it.lng, it.accuracyM, it.recordedAtMs, it.speedMps, it.headingDeg)
        }
        val previous = stored ?: lastAccepted[tripId]
        val quality = GpsFilter.classify(fix, previous) ?: return@withLock null
        // Titik dengan lompatan mustahil tidak diunggah; server juga menerapkan batas yang sama.
        if (quality == FixQuality.SPIKE) return@withLock quality
        val seq = session.lastSeq + 1
        dao.insertPoint(
            PendingPointEntity(
                tripId = tripId,
                seq = seq,
                lat = fix.lat,
                lng = fix.lng,
                accuracyM = fix.accuracyM,
                speedMps = fix.speedMps,
                headingDeg = fix.headingDeg,
                recordedAtMs = fix.recordedAtMs,
                quality = quality.name.lowercase(),
            ),
        )
        dao.updateLastSeq(tripId, seq)
        lastAccepted[tripId] = fix
        TripSyncWorker.schedule(context)
        quality
    }

    suspend fun pendingCount(tripId: String): Int = dao.pendingCount(tripId)

    suspend fun flush(): Boolean {
        val session = dao.session() ?: return true
        val points = dao.pending(session.tripId, 200)
        if (points.isEmpty()) return true
        return try {
            val response = api.addTripPoints(
                session.tripId,
                TripPointsRequest(
                    points.map {
                        TripPointRequest(
                            seq = it.seq,
                            lat = it.lat,
                            lng = it.lng,
                            accuracyM = it.accuracyM,
                            speedMps = it.speedMps,
                            headingDeg = it.headingDeg,
                            recordedAt = Instant.ofEpochMilli(it.recordedAtMs).toString(),
                        )
                    },
                ),
            )
            val handled = response.accepted + response.duplicates + response.rejected.size
            if (handled == points.size) {
                dao.deletePoints(points.map { it.id })
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun clearLocal() {
        writeMutex.withLock {
            dao.clearPoints()
            dao.clearSession()
            lastAccepted.clear()
            TripSyncWorker.cancel(context)
        }
    }
}
