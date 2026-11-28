package id.riderjourney.app.e2e

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Media ownership is enforced by the backend, and these tests prove the app
 * cannot widen it: another signed-in account cannot mint a URL for my media,
 * cannot delete it, cannot replay my capability against a different media id,
 * and a signed-out client cannot mint one at all.
 */
@RunWith(AndroidJUnit4::class)
class MediaSecurityE2ETest {

    @Before
    fun clearStoredSession() = E2e.clearSession()

    @After
    fun leaveNoSession() = E2e.clearSession()

    private fun mediaOwnedBy(prefix: String, purpose: String = "post_photo"): String {
        E2e.registerAccount(prefix)
        return E2e.upload(E2e.pngFixture("$prefix-media"), purpose)
    }

    @Test
    fun anotherAccountCannotMintASignedUrlForMyMedia() {
        val mediaId = mediaOwnedBy("sec-sign")
        E2e.registerAccount("sec-sign-other")

        val result = E2e.block { E2e.graph.mediaRepository().getSignedUrl(mediaId) }
        assertTrue("a different account must not get a capability URL", result.isFailure)
    }

    @Test
    fun anotherAccountCannotDeleteMyMedia() {
        val mediaId = mediaOwnedBy("sec-delete")
        E2e.registerAccount("sec-delete-other")

        val result = E2e.block { E2e.graph.mediaRepository().deleteMedia(mediaId) }
        assertTrue("a different account must not delete my media", result.isFailure)
    }

    @Test
    fun aSignedCapabilityIsBoundToItsMediaId() {
        // Both media belong to the same account, so visibility is not what
        // rejects the replay: only the id inside the signature can.
        E2e.registerAccount("sec-binding")
        val first = E2e.upload(E2e.pngFixture("sec-binding-a"), "post_photo")
        val second = E2e.upload(E2e.pngFixture("sec-binding-b"), "post_photo")

        val (expires, signature) = E2e.signUrlParts(first)
        val replay = runCatching {
            E2e.block { E2e.graph.api().getMediaAccess(second, expires, signature) }
        }
        assertTrue("a signature for one media cannot be replayed for another", replay.isFailure)

        val own = E2e.block { E2e.graph.api().getMediaAccess(first, expires, signature) }
        assertEquals("the capability still works for the media it was minted for", first, own.id)
    }

    @Test
    fun signedOutClientCannotMintASignedUrl() {
        val mediaId = mediaOwnedBy("sec-anon")
        E2e.clearSession()

        val result = E2e.block { E2e.graph.mediaRepository().getSignedUrl(mediaId) }
        assertTrue("no token means no capability URL", result.isFailure)
    }
}
