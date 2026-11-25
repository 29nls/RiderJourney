package id.riderjourney.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.riderjourney.app.data.MapRepository
import id.riderjourney.app.data.api.LatLngDto
import id.riderjourney.app.data.api.PlaceDto
import id.riderjourney.app.data.api.RouteOptionDto
import id.riderjourney.app.data.api.RoutePreviewRequest
import id.riderjourney.app.data.api.WaypointDto
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RouteUiState(
    val query: String = "",
    val results: List<PlaceDto> = emptyList(),
    val origin: PlaceDto? = null,
    val destination: PlaceDto? = null,
    val waypoints: List<PlaceDto> = emptyList(),
    val routes: List<RouteOptionDto> = emptyList(),
    val selectedRouteId: String? = null,
    val providerStatus: String? = null,
    val loading: Boolean = false,
    val previewing: Boolean = false,
    val recalculatingId: String? = null,
    val error: String? = null,
    val notice: String? = null,
) {
    val maxWaypoints = 7
}

@HiltViewModel
class RouteViewModel @Inject constructor(private val repository: MapRepository) : ViewModel() {
    var uiState by mutableStateOf(RouteUiState())
        private set

    fun updateQuery(value: String) {
        uiState = uiState.copy(query = value)
    }

    fun search() {
        val query = uiState.query.trim()
        if (query.length < 3) {
            uiState = uiState.copy(error = "Kata kunci minimal 3 karakter.")
            return
        }
        viewModelScope.launch {
            uiState = uiState.copy(loading = true, error = null, notice = null)
            repository.searchPlaces(query).fold(
                onSuccess = {
                    uiState = uiState.copy(
                        loading = false,
                        results = it,
                        notice = if (it.isEmpty()) "Tidak ada tempat yang cocok." else null,
                    )
                },
                onFailure = { uiState = uiState.copy(loading = false, error = it.message) },
            )
        }
    }

    fun setOrigin(place: PlaceDto) {
        uiState = uiState.copy(origin = place, routes = emptyList(), error = null)
    }

    fun setDestination(place: PlaceDto) {
        uiState = uiState.copy(destination = place, routes = emptyList(), error = null)
    }

    fun addWaypoint(place: PlaceDto) {
        if (uiState.waypoints.size >= uiState.maxWaypoints) {
            uiState = uiState.copy(error = "Maksimal ${uiState.maxWaypoints} waypoint.")
            return
        }
        uiState = uiState.copy(waypoints = uiState.waypoints + place, routes = emptyList())
    }

    fun removeWaypoint(index: Int) {
        uiState = uiState.copy(
            waypoints = uiState.waypoints.filterIndexed { i, _ -> i != index },
            routes = emptyList(),
        )
    }

    fun clearEndpoint(isOrigin: Boolean) {
        uiState = if (isOrigin) uiState.copy(origin = null, routes = emptyList()) else uiState.copy(destination = null, routes = emptyList())
    }

    fun preview() {
        val origin = uiState.origin
        val destination = uiState.destination
        if (origin == null || destination == null) {
            uiState = uiState.copy(error = "Pilih asal dan tujuan terlebih dahulu.")
            return
        }
        viewModelScope.launch {
            uiState = uiState.copy(previewing = true, error = null, notice = null)
            val request = RoutePreviewRequest(
                origin = LatLngDto(origin.location.lat, origin.location.lng),
                destination = LatLngDto(destination.location.lat, destination.location.lng),
                waypoints = uiState.waypoints.map { WaypointDto(it.location.lat, it.location.lng, it.name) },
                alternatives = true,
            )
            repository.previewRoute(request).fold(
                onSuccess = { response ->
                    uiState = uiState.copy(
                        previewing = false,
                        routes = response.routes,
                        selectedRouteId = response.routes.firstOrNull()?.id,
                        providerStatus = response.providerStatus,
                        notice = if (response.routes.isEmpty()) "Provider tidak mengembalikan rute." else null,
                    )
                },
                onFailure = { uiState = uiState.copy(previewing = false, error = it.message) },
            )
        }
    }

    fun selectRoute(routeId: String) {
        uiState = uiState.copy(selectedRouteId = routeId)
    }

    fun recalculate(routeId: String) {
        viewModelScope.launch {
            uiState = uiState.copy(recalculatingId = routeId, error = null, notice = null)
            repository.recalculateRoute(routeId).fold(
                onSuccess = { route ->
                    uiState = uiState.copy(
                        recalculatingId = null,
                        routes = uiState.routes.map { if (it.id == routeId) route else it },
                        selectedRouteId = route.id,
                        notice = "Rute diperbarui dari provider.",
                    )
                },
                onFailure = { uiState = uiState.copy(recalculatingId = null, error = it.message) },
            )
        }
    }

    fun clearMessages() {
        uiState = uiState.copy(error = null, notice = null)
    }
}
