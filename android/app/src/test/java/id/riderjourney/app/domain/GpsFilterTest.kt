package id.riderjourney.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GpsFilterTest {
    private fun fix(
        lat: Double = -6.2,
        lng: Double = 106.8,
        accuracy: Double = 10.0,
        time: Long = 1_000_000L,
        speed: Double? = null,
    ) = RawFix(lat, lng, accuracy, time, speed)

    @Test
    fun `first valid fix is accepted`() {
        assertEquals(FixQuality.OK, GpsFilter.classify(fix(), null))
    }

    @Test
    fun `low accuracy is retained with low accuracy quality`() {
        assertEquals(FixQuality.LOW_ACCURACY, GpsFilter.classify(fix(accuracy = 120.0), null))
    }

    @Test
    fun `impossible jump over one second is a spike`() {
        val previous = fix(lat = -6.2, lng = 106.8, time = 1_000_000)
        // ~1.1 km north in one second.
        val current = fix(lat = -6.19, lng = 106.8, time = 1_001_000)
        assertEquals(FixQuality.SPIKE, GpsFilter.classify(current, previous))
    }

    @Test
    fun `time gap is reported`() {
        val previous = fix(time = 1_000_000)
        val current = fix(lat = -6.2001, time = 1_090_000)
        assertEquals(FixQuality.GAP, GpsFilter.classify(current, previous))
    }

    @Test
    fun `invalid coordinates are rejected`() {
        assertNull(GpsFilter.classify(fix(lat = 95.0), null))
        assertNull(GpsFilter.classify(fix(accuracy = 0.0), null))
        assertNull(GpsFilter.classify(fix(accuracy = Double.NaN), null))
    }

    @Test
    fun `duplicate or backwards timestamp is a spike`() {
        val previous = fix(time = 1_000_000)
        assertEquals(FixQuality.SPIKE, GpsFilter.classify(fix(time = 1_000_000), previous))
        assertEquals(FixQuality.SPIKE, GpsFilter.classify(fix(time = 999_000), previous))
    }

    @Test
    fun `normal movement between fixes is accepted`() {
        val previous = fix(lat = -6.2, lng = 106.8, time = 1_000_000)
        val current = fix(lat = -6.2005, lng = 106.8005, time = 1_005_000)
        assertEquals(FixQuality.OK, GpsFilter.classify(current, previous))
    }

    @Test
    fun `distance uses haversine approximation`() {
        val metres = GpsFilter.distanceMeters(-6.2, 106.8, -6.2, 106.81)
        assertTrue(metres in 1_100.0..1_115.0)
    }
}
