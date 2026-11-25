package id.riderjourney.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import id.riderjourney.app.data.api.PlaceDto
import id.riderjourney.app.ui.components.MessageBanner
import id.riderjourney.app.ui.components.RiderMap
import id.riderjourney.app.ui.components.SectionCard
import id.riderjourney.app.ui.components.rememberUserLocation

@Composable
fun RouteScreen(viewModel: RouteViewModel = hiltViewModel()) {
    val state = viewModel.uiState
    val (userLocation, requestLocation) = rememberUserLocation()
    val selectedRoute = state.routes.firstOrNull { it.id == state.selectedRouteId } ?: state.routes.firstOrNull()
    val routePoints = selectedRoute?.geometry?.coordinates
        ?.mapNotNull { coordinate -> if (coordinate.size >= 2) coordinate[1] to coordinate[0] else null }
        .orEmpty()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Rute", style = MaterialTheme.typography.headlineSmall)
        RiderMap(
            modifier = Modifier.fillMaxWidth().height(230.dp),
            routePoints = routePoints,
            userLocation = userLocation.location,
            locationLoading = userLocation.loading,
            onRequestLocation = requestLocation,
        )
        userLocation.error?.let { MessageBanner(it, isError = true) }
        if (state.error != null) MessageBanner(state.error, isError = true)
        if (state.notice != null) MessageBanner(state.notice, isError = false)

        SectionCard("Cari tempat") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = viewModel::updateQuery,
                    label = { Text("Nama tempat / alamat") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Button(onClick = viewModel::search, enabled = !state.loading) {
                    if (state.loading) CircularProgressIndicator(Modifier.padding(4.dp)) else Text("Cari")
                }
            }
            if (state.results.isNotEmpty()) {
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.results.forEach { place ->
                        PlaceResult(place, viewModel, state.waypoints.size >= state.maxWaypoints)
                    }
                }
            }
            Text("Waypoint maksimal ${state.maxWaypoints}.", style = MaterialTheme.typography.labelSmall)
        }

        SectionCard("Asal, tujuan, waypoint") {
            EndpointRow("Asal", state.origin) { viewModel.clearEndpoint(true) }
            EndpointRow("Tujuan", state.destination) { viewModel.clearEndpoint(false) }
            state.waypoints.forEachIndexed { index, place ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("${index + 1}. ${place.name}", modifier = Modifier.weight(1f))
                    TextButton(onClick = { viewModel.removeWaypoint(index) }) { Text("Hapus") }
                }
            }
            Button(
                onClick = viewModel::preview,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                enabled = !state.previewing,
            ) {
                Text(if (state.previewing) "Menghitung..." else "Preview rute")
            }
        }

        if (state.routes.isNotEmpty()) {
            SectionCard("Hasil rute • ${state.providerStatus ?: "-"}") {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    state.routes.forEachIndexed { index, route ->
                        val selected = route.id == selectedRoute?.id
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp)) {
                                Text(
                                    "Opsi ${index + 1}${if (selected) " • ditampilkan" else ""}",
                                    style = MaterialTheme.typography.titleSmall,
                                )
                                Text("Jarak ${"%.2f".format(route.distanceM / 1000.0)} km • ETA ${formatDuration(route.durationS)}")
                                Text("Provider: ${route.provider}", style = MaterialTheme.typography.labelSmall)
                                Text(route.disclaimer, style = MaterialTheme.typography.labelSmall)
                                Row(
                                    modifier = Modifier.padding(top = 8.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    OutlinedButton(
                                        onClick = { viewModel.selectRoute(route.id) },
                                        enabled = !selected,
                                    ) { Text(if (selected) "Di peta" else "Tampilkan") }
                                    OutlinedButton(
                                        onClick = { viewModel.recalculate(route.id) },
                                        enabled = state.recalculatingId == null,
                                    ) {
                                        Text(if (state.recalculatingId == route.id) "Menghitung..." else "Hitung ulang")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaceResult(place: PlaceDto, viewModel: RouteViewModel, waypointLimitReached: Boolean) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp)) {
            Text(place.name, style = MaterialTheme.typography.bodyLarge)
            Text(
                "%.5f, %.5f".format(place.location.lat, place.location.lng),
                style = MaterialTheme.typography.labelSmall,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                AssistChip(onClick = { viewModel.setOrigin(place) }, label = { Text("Asal") })
                AssistChip(onClick = { viewModel.setDestination(place) }, label = { Text("Tujuan") })
                AssistChip(
                    onClick = { viewModel.addWaypoint(place) },
                    label = { Text(if (waypointLimitReached) "Waypoint penuh" else "Waypoint") },
                    enabled = !waypointLimitReached,
                )
            }
        }
    }
}

@Composable
private fun EndpointRow(label: String, place: PlaceDto?, onClear: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelMedium)
            Text(place?.name ?: "Belum dipilih")
        }
        if (place != null) {
            OutlinedButton(onClick = onClear) { Text("Hapus") }
        }
    }
}
