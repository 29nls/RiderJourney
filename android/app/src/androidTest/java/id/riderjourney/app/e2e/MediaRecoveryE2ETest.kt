package id.riderjourney.app.e2e

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import id.riderjourney.app.data.api.CreateUploadRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * The failure paths an upload actually has to survive: a repeated intent for the
 * same client media id, a presigned URL whose signature no longer matches (the
 * same rejection an expired URL produces), and a completion with no object.
 */
@RunWith(AndroidJUnit4::class)
class MediaRecoveryE2ETest {

    @Before
    fun clearStoredSession() = E2e.clearSession()

    @After
    fun leaveNoSession() = E2e.clearSession()

    private fun intent(clientMediaId: String, uri: Uri): CreateUploadRequest {
        val bytes = File(uri.path!!).readBytes()
        val checksum = E2e.block { E2e.graph.mediaRepository().computeSha256(uri) }
        return CreateUploadRequest(
            purpose = "post_photo",
            contentType = "image/png",
            sizeBytes = bytes.size.toLong(),
            clientMediaId = clientMediaId,
            checksumSha256 = checksum,
        )
    }

    @Test
    fun repeatingTheSameClientMediaIdDoesNotCreateASecondMedia() {
        E2e.registerAccount("recovery-duplicate")
        val uri = E2e.pngFixture("recovery-duplicate")
        val clientMediaId = "android_e2e_${UUID.randomUUID()}"
        val request = intent(clientMediaId, uri)
        val bytes = File(uri.path!!).readBytes()

        val first = E2e.block { E2e.graph.api().createUploadIntent(request) }
        val put = E2e.putObject(first.uploadUrl!!, bytes)
        assertTrue("first upload is stored, was $put", put in 200..299)
        E2e.block { E2e.graph.api().completeUpload(first.id) }

        val second = E2e.block { E2e.graph.api().createUploadIntent(request) }
        assertTrue("the retry is recognised as the same upload", second.duplicate)
        assertEquals("the retry reuses the same media row", first.id, second.id)
    }

    @Test
    fun aTamperedPresignedUrlIsRejectedAndAFreshIntentUploads() {
        E2e.registerAccount("recovery-tampered")
        val uri = E2e.pngFixture("recovery-tampered")
        val clientMediaId = "android_e2e_${UUID.randomUUID()}"
        val request = intent(clientMediaId, uri)
        val bytes = File(uri.path!!).readBytes()

        val intent = E2e.block { E2e.graph.api().createUploadIntent(request) }
        val signed = intent.uploadUrl!!
        val tampered = signed.replace(Regex("signature=[^&]+"), "signature=0000000000000000000000000000000000000000000000000000000000000000")
        assertNotEquals("the fixture actually changed the signature", signed, tampered)

        val rejected = E2e.putObject(tampered, bytes)
        assertTrue("storage rejects a URL whose signature does not match, was $rejected", rejected !in 200..299)

        val fresh = E2e.block { E2e.graph.api().createUploadIntent(request) }
        val uploaded = E2e.putObject(fresh.uploadUrl!!, bytes)
        assertTrue("a fresh intent uploads, was $uploaded", uploaded in 200..299)
        val completed = E2e.block { E2e.graph.api().completeUpload(fresh.id) }
        assertEquals("ready", completed.status)
    }

    @Test
    fun completingAnIntentWithoutTheObjectFails() {
        E2e.registerAccount("recovery-missing")
        val request = intent("android_e2e_${UUID.randomUUID()}", E2e.pngFixture("recovery-missing"))

        val created = E2e.block { E2e.graph.api().createUploadIntent(request) }
        val result = runCatching { E2e.block { E2e.graph.api().completeUpload(created.id) } }
        assertTrue("completion must not succeed when nothing was uploaded", result.isFailure)
    }
}
