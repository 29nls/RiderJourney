package id.riderjourney.app.e2e

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import id.riderjourney.app.MainActivity
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The two UI journeys that do not need a photo picker: the app starts on the
 * auth form when nothing is stored, and submitting the form with real
 * credentials reaches the signed-in shell.
 */
@RunWith(AndroidJUnit4::class)
class UiJourneyE2ETest {

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @After
    fun leaveNoSession() = E2e.clearSession()

    private fun awaitTag(tag: String, timeoutMs: Long) {
        compose.waitUntil(timeoutMs) {
            compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun appShowsTheAuthFormWithoutASession() {
        E2e.clearSession()
        compose.activityRule.scenario.recreate()

        awaitTag("auth_email", 20_000)
        compose.onNodeWithTag("auth_password").assertExists()
        compose.onNodeWithTag("auth_submit").assertExists()
    }

    @Test
    fun loginThroughTheFormOpensTheProfileTab() {
        val account = E2e.registerAccount("ui-login")
        E2e.clearSession()
        compose.activityRule.scenario.recreate()

        awaitTag("auth_email", 20_000)
        compose.onNodeWithTag("auth_email").performTextInput(account.email)
        compose.onNodeWithTag("auth_password").performTextInput(E2e.PASSWORD)
        compose.onNodeWithTag("auth_submit").performClick()

        awaitTag("tab_profile", 30_000)
        compose.onNodeWithTag("tab_garage").assertExists()
    }
}
