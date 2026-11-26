package id.riderjourney.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel

private data class Tab(val key: String, val label: String, val short: String)

private val tabs = listOf(
    Tab("home", "Beranda", "B"),
    Tab("garage", "Garasi", "G"),
    Tab("route", "Rute", "R"),
    Tab("trips", "Trip", "T"),
    Tab("convoy", "Konvoi", "K"),
    Tab("chat", "Chat", "C"),
    Tab("hazard", "Bahaya", "!"),
    Tab("profile", "Profil", "P"),
)

@Composable
fun RiderJourneyApp(
    sessionViewModel: SessionViewModel = hiltViewModel(),
    tripViewModel: TripViewModel = hiltViewModel(),
) {
    val sessionState = sessionViewModel.uiState
    var tab by rememberSaveable { mutableStateOf("home") }

    LaunchedEffect(sessionState.session?.id) {
        if (sessionState.session == null) tripViewModel.reset() else tripViewModel.refresh()
    }

    when {
        sessionState.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        sessionState.session == null -> AuthScreen(sessionViewModel)
        else -> {
            val session = sessionState.session
            Scaffold(
                bottomBar = {
                    NavigationBar {
                        tabs.forEach { item ->
                            NavigationBarItem(
                                selected = tab == item.key,
                                onClick = { tab = item.key },
                                icon = { Text(item.short) },
                                label = { Text(item.label) },
                            )
                        }
                    }
                },
            ) { padding ->
                Box(Modifier.fillMaxSize().padding(padding)) {
                    when (tab) {
                        "home" -> HomeScreen(
                            session = session,
                            tripViewModel = tripViewModel,
                            onOpenRoute = { tab = "route" },
                            onOpenGarage = { tab = "garage" },
                            onOpenTrips = { tab = "trips" },
                        )
                        "garage" -> GarageScreen()
                        "route" -> RouteScreen()
                        "trips" -> TripsScreen()
                        "convoy" -> ConvoyScreen()
                        "chat" -> ChatScreen()
                        "hazard" -> HazardScreen()
                        "profile" -> ProfileScreen(session, sessionViewModel)
                    }
                }
            }
        }
    }
}
