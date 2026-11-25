package id.riderjourney.app.domain

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class RawFix(
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val recordedAtMs: Long,
    val speedMps: Double? = null,
    val headingDeg: Double? = null,
)

enum class FixQuality { OK, LOW_ACCURACY, SPIKE, GAP }

object GpsFilter {
    private const val EARTH_RADIUS_M = 6_371_000.0
    private const val MAX_ACCURACY_M = 100.0
    private const val MAX_SPEED_MPS = 55.6 // 200 km/h
    private const val GAP_SECONDS = 60.0

    fun classify(fix: RawFix, previous: RawFix?): FixQuality? {
        if (!fix.lat.isFinite() || !fix.lng.isFinite()) return null
        if (fix.lat !in -90.0..90.0 || fix.lng !in -180.0..180.0) return null
        if (!fix.accuracyM.isFinite() || fix.accuracyM <= 0.0 || fix.accuracyM > 10_000.0) return null
        if (fix.accuracyM > MAX_ACCURACY_M) return FixQuality.LOW_ACCURACY
        if (previous == null) return FixQuality.OK
        val seconds = (fix.recordedAtMs - previous.recordedAtMs) / 1000.0
        if (seconds <= 0.0) return FixQuality.SPIKE
        if (seconds > GAP_SECONDS) return FixQuality.GAP
        val metres = distanceMeters(previous.lat, previous.lng, fix.lat, fix.lng)
        return if (metres / seconds > MAX_SPEED_MPS) FixQuality.SPIKE else FixQuality.OK
    }

    fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(a)))
    }
}
