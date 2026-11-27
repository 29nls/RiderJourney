package id.riderjourney.app.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

/**
 * The upload path reads a content URI through ContentResolver, hashes it, and
 * needs a new presigned intent when the old one is close to expiring. Those
 * three things depend on a real Android runtime, so they live here rather than
 * in a JVM unit test.
 *
 * Run with a connected device or emulator:
 *   ./gradlew connectedDebugAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class MediaContentUriTest {

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun contentUriIsReadableThroughContentResolver() {
        val file = File(context.cacheDir, "checksum-fixture.bin")
        file.writeBytes(ByteArray(MediaChecksum.BUFFER_SIZE * 3 + 7) { (it % 251).toByte() })
        // file:// is still resolved through ContentResolver, which is the code
        // path uploads use; no app-specific provider authority is assumed here.
        val uri = android.net.Uri.fromFile(file)

        val digest = context.contentResolver.openInputStream(uri)!!.use { MediaChecksum.sha256Hex(it) }
        val expected = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
            .joinToString("") { "%02x".format(it) }

        assertEquals("checksum matches the bytes behind the URI", expected, digest)
        val size = context.contentResolver.openInputStream(uri)!!.use { MediaChecksum.countBytes(it) }
        assertEquals(file.length(), size)
        file.delete()
    }

    @Test
    fun presignedIntentExpiryUsesAMargin() {
        val now = 1_000_000L
        assertFalse("60s left is inside the margin", MediaChecksum.needsNewIntent(now + 59_000, now))
        assertTrue("2 minutes left is outside the margin", MediaChecksum.needsNewIntent(now + 120_000, now))
    }
}
