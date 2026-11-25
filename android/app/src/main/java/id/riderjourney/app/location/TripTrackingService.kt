package id.riderjourney.app.location

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import dagger.hilt.android.AndroidEntryPoint
import id.riderjourney.app.MainActivity
import id.riderjourney.app.R
import id.riderjourney.app.data.TripRecorder
import id.riderjourney.app.domain.RawFix
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@AndroidEntryPoint
class TripTrackingService : Service() {
    @Inject lateinit var recorder: TripRecorder

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var fused: FusedLocationProviderClient
    private var tripId: String? = null
    private var tracking = false

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val trip = tripId ?: return
            for (location in result.locations) {
                val fix = RawFix(
                    lat = location.latitude,
                    lng = location.longitude,
                    accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else 0.0,
                    recordedAtMs = location.time,
                    speedMps = if (location.hasSpeed()) location.speed.toDouble() else null,
                    headingDeg = if (location.hasBearing()) location.bearing.toDouble() else null,
                )
                scope.launch { recorder.record(trip, fix) }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        fused = LocationServices.getFusedLocationProviderClient(this)
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!startAsForeground()) return START_NOT_STICKY
        if (!hasForegroundLocationPermission()) {
            stopSelf()
            return START_NOT_STICKY
        }
        val requestedTrip = intent?.getStringExtra(EXTRA_TRIP_ID)
        if (requestedTrip != null) tripId = requestedTrip
        if (tripId == null) {
            scope.launch {
                tripId = recorder.activeSession()?.tripId
                if (tripId == null) stopSelf() else startUpdates()
            }
        } else {
            startUpdates()
        }
        return START_STICKY
    }

    private fun startUpdates() {
        if (tracking) return
        tracking = true
        scope.launch {
            // A sticky restart can revive a paused/finished session. Check before
            // requesting GPS so the foreground service and battery cost are honest.
            val session = recorder.activeSession()
            if (session == null || session.tripId != tripId || session.status != "active") {
                tracking = false
                stopSelf()
                return@launch
            }
            withContext(Dispatchers.Main) {
                val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
                    .setMinUpdateDistanceMeters(3f)
                    .setWaitForAccurateLocation(false)
                    .build()
                try {
                    fused.requestLocationUpdates(request, callback, mainLooper)
                } catch (_: SecurityException) {
                    tracking = false
                    stopSelf()
                }
            }
        }
    }

    private fun startAsForeground(): Boolean {
        val notification = buildNotification()
        return try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            true
        } catch (_: SecurityException) {
            stopSelf()
            false
        }
    }

    private fun buildNotification(): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Merekam perjalanan")
            .setContentText("Titik GPS dikirim otomatis saat koneksi tersedia.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(openApp)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.tracking_channel_name),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = getString(R.string.tracking_channel_description) },
            )
        }
    }

    private fun hasForegroundLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onDestroy() {
        if (::fused.isInitialized) fused.removeLocationUpdates(callback)
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_STOP = "id.riderjourney.app.action.STOP_TRACKING"
        const val EXTRA_TRIP_ID = "trip_id"
        private const val CHANNEL_ID = "trip_tracking"
        private const val NOTIFICATION_ID = 41

        fun start(context: android.content.Context, tripId: String) {
            val intent = Intent(context, TripTrackingService::class.java).putExtra(EXTRA_TRIP_ID, tripId)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: android.content.Context) {
            context.stopService(Intent(context, TripTrackingService::class.java))
        }
    }
}
