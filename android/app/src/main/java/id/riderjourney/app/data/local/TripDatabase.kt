package id.riderjourney.app.data.local

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Update
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Entity(tableName = "trip_sessions")
data class TripSessionEntity(
    @PrimaryKey val tripId: String,
    val startedAtMs: Long,
    val status: String,
    val lastSeq: Int,
)

@Entity(tableName = "pending_points", indices = [Index("tripId"), Index(value = ["tripId", "seq"], unique = true)])
data class PendingPointEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val tripId: String,
    val seq: Int,
    val lat: Double,
    val lng: Double,
    val accuracyM: Double,
    val speedMps: Double?,
    val headingDeg: Double?,
    val recordedAtMs: Long,
    val quality: String,
)

@Dao
interface TripDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveSession(session: TripSessionEntity)

    @Query("SELECT * FROM trip_sessions LIMIT 1")
    suspend fun session(): TripSessionEntity?

    @Query("UPDATE trip_sessions SET status = :status WHERE tripId = :tripId")
    suspend fun updateStatus(tripId: String, status: String)

    @Query("UPDATE trip_sessions SET lastSeq = :seq WHERE tripId = :tripId")
    suspend fun updateLastSeq(tripId: String, seq: Int)

    @Query("DELETE FROM trip_sessions")
    suspend fun clearSession()

    @Insert
    suspend fun insertPoint(point: PendingPointEntity): Long

    @Query("SELECT * FROM pending_points WHERE tripId = :tripId ORDER BY seq ASC LIMIT :limit")
    suspend fun pending(tripId: String, limit: Int = 200): List<PendingPointEntity>

    @Query("SELECT * FROM pending_points WHERE tripId = :tripId ORDER BY seq DESC LIMIT 1")
    suspend fun latestPoint(tripId: String): PendingPointEntity?

    @Query("SELECT COUNT(*) FROM pending_points WHERE tripId = :tripId")
    suspend fun pendingCount(tripId: String): Int

    @Query("DELETE FROM pending_points WHERE id IN (:ids)")
    suspend fun deletePoints(ids: List<Long>)

    @Query("DELETE FROM pending_points")
    suspend fun clearPoints()
}

@Entity(tableName = "media_uploads", indices = [Index(value = ["clientMediaId"], unique = true)])
data class MediaUploadEntity(
    @PrimaryKey val id: String, // client-generated UUID
    val clientMediaId: String,
    val mediaId: String? = null, // server-assigned media ID
    val purpose: String,
    val contentType: String,
    val sizeBytes: Long,
    val checksumSha256: String,
    val localUri: String,
    val uploadUrl: String? = null,
    val expiresAtMs: Long = 0,
    val state: String = "idle", // idle|preparing|uploading|completing|ready|failed|expired|cancelled
    val progress: Float = 0f,
    val errorMessage: String? = null,
    val retryCount: Int = 0,
    val createdAtMs: Long = System.currentTimeMillis(),
    val updatedAtMs: Long = System.currentTimeMillis(),
)

@Dao
interface MediaUploadDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(upload: MediaUploadEntity)

    @Update
    suspend fun update(upload: MediaUploadEntity)

    @Query("SELECT * FROM media_uploads WHERE id = :id")
    suspend fun getById(id: String): MediaUploadEntity?

    @Query("SELECT * FROM media_uploads WHERE clientMediaId = :clientMediaId")
    suspend fun getByClientMediaId(clientMediaId: String): MediaUploadEntity?

    @Query("SELECT * FROM media_uploads WHERE state IN ('idle', 'preparing', 'uploading', 'completing', 'failed') ORDER BY createdAtMs ASC")
    suspend fun pendingUploads(): List<MediaUploadEntity>

    @Query("UPDATE media_uploads SET state = :state, errorMessage = :error, updatedAtMs = :now WHERE id = :id")
    suspend fun updateState(id: String, state: String, error: String? = null, now: Long = System.currentTimeMillis())

    @Query("UPDATE media_uploads SET state = :state, progress = :progress, updatedAtMs = :now WHERE id = :id")
    suspend fun updateProgress(id: String, state: String, progress: Float, now: Long = System.currentTimeMillis())

    @Query("UPDATE media_uploads SET mediaId = :mediaId, uploadUrl = :uploadUrl, expiresAtMs = :expiresAtMs, state = 'preparing', updatedAtMs = :now WHERE id = :id")
    suspend fun setIntent(id: String, mediaId: String, uploadUrl: String, expiresAtMs: Long, now: Long = System.currentTimeMillis())

    @Query("DELETE FROM media_uploads WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM media_uploads WHERE state = 'ready'")
    suspend fun clearCompleted()
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE IF NOT EXISTS media_uploads (
                id TEXT NOT NULL PRIMARY KEY,
                clientMediaId TEXT NOT NULL,
                mediaId TEXT,
                purpose TEXT NOT NULL,
                contentType TEXT NOT NULL,
                sizeBytes INTEGER NOT NULL,
                checksumSha256 TEXT NOT NULL,
                localUri TEXT NOT NULL,
                uploadUrl TEXT,
                expiresAtMs INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL DEFAULT 'idle',
                progress REAL NOT NULL DEFAULT 0,
                errorMessage TEXT,
                retryCount INTEGER NOT NULL DEFAULT 0,
                createdAtMs INTEGER NOT NULL DEFAULT 0,
                updatedAtMs INTEGER NOT NULL DEFAULT 0
            )"""
        )
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_media_uploads_clientMediaId ON media_uploads (clientMediaId)")
    }
}

@Database(entities = [TripSessionEntity::class, PendingPointEntity::class, MediaUploadEntity::class], version = 2, exportSchema = false)
abstract class TripDatabase : RoomDatabase() {
    abstract fun tripDao(): TripDao
    abstract fun mediaUploadDao(): MediaUploadDao
}
