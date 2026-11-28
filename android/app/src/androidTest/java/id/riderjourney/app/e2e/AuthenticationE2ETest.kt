package id.riderjourney.app.e2e

import androidx.test.ext.junit.runners.AndroidJUnit4
import id.riderjourney.app.data.ApiException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The auth journeys the app actually performs, against the real backend:
 * register, login, logout, a repository restarted on stored tokens, an expired
 * access token refreshed from the refresh token, and a missing token rejected.
 *
 * Every test creates its own account, so ordering and repetition do not matter.
 */
@RunWith(AndroidJUnit4::class)
class AuthenticationE2ETest {

    @Before
    fun clearStoredSession() = E2e.clearSession()

    @After
    fun leaveNoSession() = E2e.clearSession()

    @Test
    fun registerReturnsASessionTheApiAccepts() {
        val registered = E2e.registerAccount("auth-register")
        assertEquals(
            "the token minted by register authenticates as the same user",
            registered.id,
            E2e.block { E2e.graph.authRepository().session().getOrThrow() }.id,
        )
        assertTrue("register leaves a usable access token", E2e.hasSession())
    }

    @Test
    fun loginAfterLogoutRestoresTheSameAccount() {
        val registered = E2e.registerAccount("auth-login")
        val email = registered.email

        E2e.block { E2e.graph.authRepository().logout().getOrThrow() }
        assertFalse("logout clears the local session", E2e.hasSession())

        val loggedIn = E2e.block {
            E2e.graph.authRepository().login(email, E2e.PASSWORD).getOrThrow()
        }
        assertEquals("logging back in reaches the same account", registered.id, loggedIn.id)
    }

    @Test
    fun storedTokensSurviveANewRepositoryInstance() {
        val registered = E2e.registerAccount("auth-persist")
        assertNotNull(E2e.graph.tokenStore().refreshToken())

        // A fresh repository with nothing in memory: the only session it can
        // have is the one persisted in TokenStore.
        val restarted = E2e.newRepository()
        val session = E2e.block { restarted.session().getOrThrow() }
        assertEquals(registered.id, session.id)
    }

    @Test
    fun expiredAccessTokenIsRefreshedFromTheStoredRefreshToken() {
        val registered = E2e.registerAccount("auth-refresh")
        val refresh = E2e.graph.tokenStore().refreshToken()
        assertNotNull("register must store a refresh token", refresh)

        E2e.graph.tokenStore().save("not-a-valid-access-token", refresh!!)
        val session = E2e.block { E2e.graph.authRepository().session().getOrThrow() }

        assertEquals("the 401 was retried after a refresh", registered.id, session.id)
        assertTrue(
            "the access token was replaced, not replayed",
            E2e.graph.tokenStore().accessToken() != "not-a-valid-access-token",
        )
    }

    @Test
    fun requestWithoutATokenIsRejected() {
        E2e.clearSession()
        assertNull(E2e.graph.tokenStore().accessToken())

        val result = E2e.block { E2e.graph.authRepository().session() }
        assertTrue("session must fail without credentials", result.isFailure)
        val error = result.exceptionOrNull()
        assertTrue(
            "the backend rejection is surfaced as UNAUTHENTICATED, was: $error",
            error is ApiException && error.code == "UNAUTHENTICATED",
        )
    }
}
