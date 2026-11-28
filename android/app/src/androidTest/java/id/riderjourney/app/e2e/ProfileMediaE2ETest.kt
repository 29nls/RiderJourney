package id.riderjourney.app.e2e

import android.graphics.Color
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import id.riderjourney.app.data.api.UpdateProfileRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Avatar journeys through the app's MediaRepository and AuthRepository: upload,
 * attach, display (signed URL resolves to real bytes), replace, remove, and the
 * quota accounting the profile screen shows.
 */
@RunWith(AndroidJUnit4::class)
class ProfileMediaE2ETest {

    @Before
    fun clearStoredSession() = E2e.clearSession()

    @After
    fun leaveNoSession() = E2e.clearSession()

    private fun attachAvatar(uri: Uri): String {
        val mediaId = E2e.upload(uri, "avatar")
        val updated = E2e.block {
            E2e.graph.authRepository().updateProfile(UpdateProfileRequest(avatarUrl = "", avatarMediaId = mediaId)).getOrThrow()
        }
        assertEquals("profile points at the uploaded media", mediaId, updated.avatarMediaId)
        return mediaId
    }

    @Test
    fun uploadedAvatarBecomesTheProfileAvatarAndIsReadable() {
        E2e.registerAccount("profile-avatar")
        val mediaId = attachAvatar(E2e.pngFixture("avatar-a"))

        assertEquals(mediaId, E2e.awaitAvatar(mediaId).avatarMediaId)
        val download = E2e.block { E2e.graph.mediaRepository().resolveDownloadUrl(mediaId).getOrThrow() }
        assertTrue("signed download url is absolute", download.startsWith("http"))
        val bytes = E2e.block { java.net.URL(download).readBytes() }
        assertTrue("the stored object is not empty", bytes.size > 0)
    }

    @Test
    fun replacingTheAvatarMovesTheReferenceToTheNewMedia() {
        E2e.registerAccount("profile-replace")
        val first = attachAvatar(E2e.pngFixture("avatar-first", Color.RED))
        val second = attachAvatar(E2e.pngFixture("avatar-second", Color.GREEN))

        assertNotEquals("a second upload is a different media row", first, second)
        assertEquals("profile now points at the replacement", second, E2e.awaitAvatar(second).avatarMediaId)
    }

    @Test
    fun removingTheAvatarClearsTheProfileReference() {
        E2e.registerAccount("profile-remove")
        attachAvatar(E2e.pngFixture("avatar-remove"))

        val cleared = E2e.block {
            E2e.graph.authRepository().updateProfile(UpdateProfileRequest(avatarUrl = "", avatarMediaId = "")).getOrThrow()
        }
        assertNull("avatar reference is gone", cleared.avatarMediaId)
    }

    @Test
    fun quotaCountsTheBytesOfAnUploadedAvatar() {
        E2e.registerAccount("profile-quota")
        val before = E2e.block { E2e.graph.mediaRepository().getQuota().getOrThrow() }.usedBytes

        val uri = E2e.pngFixture("avatar-quota")
        val size = File(uri.path!!).length()
        attachAvatar(uri)

        val after = E2e.block(60) {
            val repo = E2e.graph.mediaRepository()
            val deadline = System.currentTimeMillis() + 30_000
            var used = repo.getQuota().getOrThrow().usedBytes
            while (used < before + size && System.currentTimeMillis() < deadline) {
                Thread.sleep(1000)
                used = repo.getQuota().getOrThrow().usedBytes
            }
            used
        }
        assertTrue("used bytes grew by the uploaded object ($before -> $after, size $size)", after >= before + size)
    }

    @Test
    fun deletingAnUnreferencedMediaReportsDeleting() {
        E2e.registerAccount("profile-delete")
        val mediaId = E2e.upload(E2e.pngFixture("post-photo"), "post_photo")

        val response = E2e.block { E2e.graph.mediaRepository().deleteMedia(mediaId).getOrThrow() }
        assertEquals(mediaId, response.id)
        assertTrue("server answers deleting or deleted, was ${response.status}", response.status in setOf("deleting", "deleted"))
    }
}
