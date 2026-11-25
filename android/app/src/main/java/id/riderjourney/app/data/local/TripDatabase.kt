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

@Database(entities = [TripSessionEntity::class, PendingPointEntity::class], version = 1, exportSchema = false)
abstract class TripDatabase : RoomDatabase() {
    abstract fun tripDao(): TripDao
}
