package id.riderjourney.app.data

import id.riderjourney.app.data.local.MediaUploadEntity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which stranded rows the background retry is allowed to touch. */
class MediaResumableUploadsTest {

    private fun entity(state: String, retryCount: Int) = MediaUploadEntity(
        id = "row",
        clientMediaId = "android_row",
        purpose = "post_photo",
        contentType = "image/png",
        sizeBytes = 1,
        checksumSha256 = "0".repeat(64),
        localUri = "file:///tmp/row",
        state = state,
        retryCount = retryCount,
    )

    @Test
    fun `cancelled rows stay cancelled`() {
        assertFalse(MediaRepository.resumable(entity("cancelled", retryCount = 0)))
    }

    @Test
    fun `rows that spent their retries stay put`() {
        assertFalse(MediaRepository.resumable(entity("failed", retryCount = 3)))
    }

    @Test
    fun `a stranded upload is resumable`() {
        assertTrue(MediaRepository.resumable(entity("uploading", retryCount = 0)))
        assertTrue(MediaRepository.resumable(entity("failed", retryCount = 2)))
    }
}
