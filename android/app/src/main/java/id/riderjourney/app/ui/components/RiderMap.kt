package id.riderjourney.app.ui.components

import androidx.core.graphics.toColorInt
import android.os.Bundle
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import id.riderjourney.app.BuildConfig
import id.riderjourney.app.data.api.LatLngDto
import org.maplibre.android.MapLibre
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

data class MapMarker(
    val id: String,
    val label: String,
    val lat: Double,
    val lng: Double,
    val stale: Boolean = false,
)

private const val ROUTE_SOURCE = "convoy-route"
private const val ROUTE_LAYER = "convoy-route-line"

@Composable
fun RiderMap(
    modifier: Modifier = Modifier,
    markers: List<MapMarker> = emptyList(),
    routePoints: List<Pair<Double, Double>> = emptyList(),
    userLocation: LatLngDto? = null,
    locationLoading: Boolean = false,
    onRequestLocation: (() -> Unit)? = null,
) {
    val styleUrl = BuildConfig.MAP_STYLE_URL
    if (styleUrl.isBlank()) {
        ConfigCard(
            title = "Peta belum dikonfigurasi",
            description = "Isi RJ_MAP_STYLE_URL dengan style MapLibre/MapTiler yang sah. Aplikasi tidak menampilkan peta atau rute palsu saat konfigurasi kosong.",
            modifier = modifier.fillMaxWidth(),
        )
        return
    }

    val context = androidx.compose.ui.platform.LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var failed = remember { mutableStateOf<String?>(null) }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var centeredOnMembers by remember { mutableStateOf(false) }
    val mapView = remember {
        runCatching {
            MapLibre.getInstance(context)
            MapView(context).apply {
                onCreate(Bundle())
                getMapAsync { loaded ->
                    loaded.setStyle(styleUrl) { map = loaded }
                }
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                    onStart()
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) onResume()
                }
            }
        }.onFailure { failed.value = it.message }.getOrNull()
    }

    if (mapView == null) {
        ConfigCard(
            title = "Peta gagal dimuat",
            description = failed.value ?: "Periksa konfigurasi style dan koneksi.",
            modifier = modifier.fillMaxWidth(),
        )
        return
    }

    DisposableEffect(lifecycle, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_CREATE -> mapView.onCreate(Bundle())
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                Lifecycle.Event.ON_DESTROY -> mapView.onDestroy()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            mapView.onDestroy()
        }
    }

    LaunchedEffect(map, markers, routePoints, userLocation) {
        val loaded = map ?: return@LaunchedEffect
        loaded.clear()
        val visibleMarkers = if (userLocation == null) {
            markers
        } else {
            markers + MapMarker("self", "Lokasi Anda", userLocation.lat, userLocation.lng)
        }
        for (marker in visibleMarkers) {
            loaded.addMarker(
                MarkerOptions()
                    .position(LatLng(marker.lat, marker.lng))
                    .title(marker.label)
                    .snippet(if (marker.stale) "Lokasi stale" else null),
            )
        }
        loaded.getStyle { style ->
            val source = style.getSourceAs<GeoJsonSource>(ROUTE_SOURCE)
                ?: GeoJsonSource(ROUTE_SOURCE).also { style.addSource(it) }
            val line = if (routePoints.size >= 2) {
                FeatureCollection.fromFeatures(
                    listOf(Feature.fromGeometry(LineString.fromLngLats(routePoints.map { Point.fromLngLat(it.second, it.first) }))),
                )
            } else {
                FeatureCollection.fromFeatures(emptyList())
            }
            source.setGeoJson(line)
            if (style.getLayer(ROUTE_LAYER) == null) {
                style.addLayer(
                    LineLayer(ROUTE_LAYER, ROUTE_SOURCE).withProperties(
                        lineColor("#FF6B3D".toColorInt()),
                        lineWidth(4f),
                    ),
                )
            }
        }
        if (!centeredOnMembers) {
            val focus = userLocation?.let { LatLng(it.lat, it.lng) }
                ?: markers.firstOrNull()?.let { LatLng(it.lat, it.lng) }
                ?: routePoints.firstOrNull()?.let { LatLng(it.first, it.second) }
            if (focus != null) {
                loaded.animateCamera(CameraUpdateFactory.newLatLngZoom(focus, 13.0))
                centeredOnMembers = true
            }
        }
    }

    LaunchedEffect(map, userLocation?.lat, userLocation?.lng) {
        val loaded = map ?: return@LaunchedEffect
        val location = userLocation ?: return@LaunchedEffect
        loaded.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(location.lat, location.lng), 15.0))
    }

    Box(modifier.clip(RoundedCornerShape(18.dp))) {
        AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())
        Column(
            modifier = Modifier.align(Alignment.TopEnd).padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            MapControl("+") { map?.animateCamera(CameraUpdateFactory.zoomIn()) }
            MapControl("\u2212") { map?.animateCamera(CameraUpdateFactory.zoomOut()) }
        }
        if (onRequestLocation != null) {
            Surface(
                modifier = Modifier.align(Alignment.BottomStart).padding(8.dp),
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                shadowElevation = 2.dp,
            ) {
                Text(
                    text = when {
                        locationLoading -> "Mencari lokasi..."
                        userLocation != null -> "Perbarui lokasi saya"
                        else -> "Lokasi saya"
                    },
                    modifier = Modifier.clickable(enabled = !locationLoading, onClick = onRequestLocation).padding(horizontal = 12.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
        if (BuildConfig.MAP_ATTRIBUTION.isNotBlank()) {
            Text(
                BuildConfig.MAP_ATTRIBUTION,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.78f))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                fontSize = 9.sp,
            )
        }
    }
}

@Composable
private fun MapControl(label: String, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        shadowElevation = 2.dp,
    ) {
        Box(
            modifier = Modifier.size(36.dp).clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Text(label, style = MaterialTheme.typography.titleMedium)
        }
    }
}
