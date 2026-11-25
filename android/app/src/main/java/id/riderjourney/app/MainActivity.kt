package id.riderjourney.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import dagger.hilt.android.AndroidEntryPoint
import id.riderjourney.app.ui.RiderJourneyApp
import id.riderjourney.app.ui.theme.RiderJourneyTheme

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            RiderJourneyTheme {
                RiderJourneyApp()
            }
        }
    }
}
