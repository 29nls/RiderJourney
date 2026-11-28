package id.riderjourney.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.net.toUri
import android.util.LruCache
import dagger.hilt.android.qualifiers.ApplicationContext
import id.riderjourney.app.data.api.CreateUploadRequest
import id.riderjourney.app.data.api.DeleteMediaResponse
import id.riderjourney.app.data.api.RiderJourneyApi
import id.riderjourney.app.data.api.SignedUrlResponse
import id.riderjourney.app.data.local.MediaUploadDao
import id.riderjourney.app.data.local.MediaUploadEntity
import id.riderjourney.app.work.MediaUploadWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import java.io.InputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Upload lifecycle states:
 * idle → preparing → uploading → completing → ready
 *                 ↘ failed (retryable)
 *                 ↘ expired (intent expired; a retry re-issues it)
 *                 ↘ cancelled
 *
 * Retries reuse the same `clientMediaId`, so the backend's unique
 * (owner_id, client_media_id) index keeps a retry on the same media row
 * instead of creating a duplicate. Presigned URLs are never reused past
 * their expiry: retry always asks for a fresh intent.
 */
@Singleton
class MediaRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: RiderJourneyApi,
    @Named("storage") private val storageClient: OkHttpClient,
    private val dao: MediaUploadDao,
) {
    companion object {
        private const val MAX_RETRIES = 3
        private const val MAX_IMAGE_BYTES = 12 * 1024 * 1024

        /** User-cancelled uploads stay cancelled; the rest are resumable while retries remain. */
        internal fun resumable(upload: MediaUploadEntity): Boolean =
            upload.state != "cancelled" && upload.retryCount < MAX_RETRIES
    }

    private val imageCache = LruCache<String, Bitmap>(12)
    private val imageLock = Mutex()

    private val imageTypes = setOf("image/jpeg", "image/png", "image/webp")

    /** Content type from the provider, restricted to what the backend accepts. */
    fun imageContentType(uri: Uri): String? =
        context.contentResolver.getType(uri)?.lowercase()?.takeIf { it in imageTypes }

    suspend fun computeSha256(uri: Uri): String = withContext(Dispatchers.IO) {
        val input: InputStream = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("Cannot open URI: $uri")
        input.use { MediaChecksum.sha256Hex(it) }
    }

    suspend fun getFileSize(uri: Uri): Long = withContext(Dispatchers.IO) {
        val afd = context.contentResolver.openAssetFileDescriptor(uri, "r")
            ?: throw IllegalArgumentException("Cannot determine file size: $uri")
        afd.use {
            if (it.length >= 0) return@withContext it.length
            val input = context.contentResolver.openInputStream(uri)
                ?: throw IllegalArgumentException("Cannot open URI: $uri")
            input.use { stream -> MediaChecksum.countBytes(stream) }
        }
    }

    /** New upload: intent → PUT → complete, persisted in Room at every step. */
    suspend fun upload(
        uri: Uri,
        purpose: String,
        contentType: String,
        onProgress: (Float) -> Unit = {},
    ): Result<MediaUploadEntity> = runUpload(
        uri = uri,
        purpose = purpose,
        contentType = contentType,
        clientMediaId = "android_${UUID.randomUUID()}",
        localId = UUID.randomUUID().toString(),
        retryCount = 0,
        onProgress = onProgress,
    ).onFailure { MediaUploadWorker.enqueue(context) }

    /**
     * Resume a failed/interrupted upload. Always re-issues the intent with the
     * original clientMediaId: an expired intent is re-armed server-side on the
     * same media row, and a fresh presigned URL avoids replaying a stale one.
     */
    suspend fun retry(uploadId: String, onProgress: (Float) -> Unit = {}): Result<MediaUploadEntity> {
        val entity = dao.getById(uploadId) ?: return Result.failure(IllegalStateException("Upload not found"))
        if (entity.state == "ready") return Result.success(entity)
        if (entity.state == "cancelled") return Result.failure(IllegalStateException("Upload was cancelled"))
        if (entity.retryCount >= MAX_RETRIES) {
            dao.updateState(uploadId, "failed", "Max retries exceeded")
            return Result.failure(IllegalStateException("Max retries exceeded"))
        }
        val uri = entity.localUri.toUri()
        dao.upsert(entity.copy(retryCount = entity.retryCount + 1, state = "preparing"))
        return runUpload(
            uri = uri,
            purpose = entity.purpose,
            contentType = entity.contentType,
            clientMediaId = entity.clientMediaId,
            localId = entity.id,
            retryCount = entity.retryCount + 1,
            onProgress = onProgress,
        )
    }

    suspend fun uploadImage(
        uri: Uri,
        purpose: String,
        onProgress: (Float) -> Unit = {},
    ): Result<MediaUploadEntity> {
        val contentType = imageContentType(uri)
            ?: return Result.failure(IllegalArgumentException("Format gambar harus JPEG, PNG, atau WebP"))
        return upload(uri, purpose, contentType, onProgress)
    }

    private suspend fun runUpload(
        uri: Uri,
        purpose: String,
        contentType: String,
        clientMediaId: String,
        localId: String,
        retryCount: Int,
        onProgress: (Float) -> Unit,
    ): Result<MediaUploadEntity> = withContext(Dispatchers.IO) {
        try {
            onProgress(0f)
            val sizeBytes = getFileSize(uri)
            require(sizeBytes in 1..MediaChecksum.MAX_UPLOAD_BYTES) { "Ukuran berkas tidak didukung" }
            val checksum = computeSha256(uri)

            dao.upsert(
                MediaUploadEntity(
                    id = localId,
                    clientMediaId = clientMediaId,
                    purpose = purpose,
                    contentType = contentType,
                    sizeBytes = sizeBytes,
                    checksumSha256 = checksum,
                    localUri = uri.toString(),
                    state = "preparing",
                    retryCount = retryCount,
                ),
            )

            val intent = api.createUploadIntent(
                CreateUploadRequest(
                    purpose = purpose,
                    contentType = contentType,
                    sizeBytes = sizeBytes,
                    clientMediaId = clientMediaId,
                    checksumSha256 = checksum,
                ),
            )

            if (intent.duplicate && intent.status == "ready") {
                val ready = (dao.getById(localId) ?: error("Upload entity lost")).copy(
                    mediaId = intent.id,
                    state = "ready",
                    progress = 1f,
                    errorMessage = null,
                )
                dao.upsert(ready)
                return@withContext Result.success(ready)
            }
            if (intent.status == "expired") {
                dao.updateState(localId, "expired", "Upload intent kedaluwarsa")
                return@withContext Result.failure(IllegalStateException("Upload intent kedaluwarsa"))
            }

            val uploadUrl = intent.uploadUrl
                ?: return@withContext Result.failure(IllegalStateException("No upload URL returned"))
            val expiresAtMs = System.currentTimeMillis() + ((intent.expiresIn ?: 300) * 1000L)
            dao.setIntent(localId, intent.id, uploadUrl, expiresAtMs)

            onProgress(0.1f)
            dao.updateProgress(localId, "uploading", 0.1f)
            // Per-chunk progress is reported to the UI only. This lambda runs on
            // OkHttp's writing thread, where a suspending Room write is not
            // allowed; Room records the phase (0.1 before PUT, 0.85 completing),
            // which is what a resumed upload actually needs.
            val putResult = executePut(uri, uploadUrl, contentType, sizeBytes) { progress ->
                onProgress(0.1f + progress * 0.7f)
            }
            if (!putResult) {
                dao.updateState(localId, "failed", "PUT upload failed")
                return@withContext Result.failure(IllegalStateException("PUT upload failed"))
            }

            dao.updateProgress(localId, "completing", 0.85f)
            onProgress(0.85f)
            val complete = api.completeUpload(intent.id)
            val ready = complete.status == "ready"
            val finalEntity = (dao.getById(localId) ?: error("Upload entity lost")).copy(
                mediaId = intent.id,
                state = if (ready) "ready" else "failed",
                progress = if (ready) 1f else 0.85f,
                errorMessage = if (ready) null else "Completion returned: ${complete.status}",
            )
            dao.upsert(finalEntity)
            onProgress(1f)
            Result.success(finalEntity)
        } catch (e: Exception) {
            dao.updateState(localId, "failed", e.message)
            Result.failure(e)
        }
    }

    suspend fun cancel(uploadId: String) {
        dao.updateState(uploadId, "cancelled")
    }

    suspend fun pendingUploads(): List<MediaUploadEntity> = dao.pendingUploads()

    /**
     * Work the background retry may touch: the same rows the pending pane shows,
     * minus what the user cancelled and minus what already used its retries.
     */
    suspend fun resumableUploads(): List<MediaUploadEntity> =
        dao.pendingUploads().filter(::resumable)

    /** Get a signed capability URL for display. */
    suspend fun getSignedUrl(mediaId: String): Result<SignedUrlResponse> = runCatching {
        api.getSignedUrl(mediaId)
    }

    /** Resolve a signed capability URL to the short-lived object download URL. */
    suspend fun resolveDownloadUrl(mediaId: String): Result<String> = runCatching {
        val signed = api.getSignedUrl(mediaId)
        val accessUrl = signed.url ?: throw IllegalStateException("No signed URL")
        val uri = accessUrl.toUri()
        val expires = uri.getQueryParameter("expires") ?: throw IllegalStateException("Missing expires")
        val signature = uri.getQueryParameter("signature") ?: throw IllegalStateException("Missing signature")
        val access = api.getMediaAccess(mediaId, expires, signature)
        access.downloadUrl ?: throw IllegalStateException("No download URL")
    }

    /**
     * Load a media image through the authenticated API. The signed URL is
     * fetched per load (cached bitmap skips it), so an expired URL is never
     * reused: a cache miss always mints a fresh one.
     */
    suspend fun loadImage(mediaId: String): Result<Bitmap> {
        imageCache.get(mediaId)?.let { return Result.success(it) }
        return imageLock.withLock {
            imageCache.get(mediaId)?.let { return@withLock Result.success(it) }
            withContext(Dispatchers.IO) {
                runCatching {
                    val url = resolveDownloadUrl(mediaId).getOrThrow()
                    val request = Request.Builder().url(url).get().build()
                    storageClient.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}")
                        val body = response.body ?: throw IllegalStateException("Empty body")
                        if (body.contentLength() > MAX_IMAGE_BYTES) throw IllegalStateException("Gambar terlalu besar")
                        val bytes = body.bytes()
                        if (bytes.size > MAX_IMAGE_BYTES) throw IllegalStateException("Gambar terlalu besar")
                        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                            ?: throw IllegalStateException("Format gambar tidak dikenal")
                        imageCache.put(mediaId, bitmap)
                        bitmap
                    }
                }
            }
        }
    }

    fun forgetImage(mediaId: String) {
        imageCache.remove(mediaId)
    }

    suspend fun getQuota() = runCatching { api.storageQuota() }

    /**
     * Request deletion of one media. The server answers 'deleting' and releases
     * quota only after the worker proves the object is gone; a media still used
     * by a post, album, trip, poster, hazard, avatar, or vehicle answers
     * MEDIA_IN_USE and is left untouched.
     */
    suspend fun deleteMedia(mediaId: String): Result<DeleteMediaResponse> = runCatching {
        api.deleteMedia(mediaId).also { forgetImage(mediaId) }
    }

    private suspend fun executePut(
        uri: Uri,
        uploadUrl: String,
        contentType: String,
        sizeBytes: Long,
        onProgress: (Float) -> Unit,
    ): Boolean = withContext(Dispatchers.IO) {
        val body = object : RequestBody() {
            override fun contentType() = contentType.toMediaType()
            override fun contentLength() = sizeBytes

            override fun writeTo(sink: BufferedSink) {
                val input = context.contentResolver.openInputStream(uri)
                    ?: throw IllegalStateException("Cannot open URI")
                input.use { stream ->
                    val buffer = ByteArray(MediaChecksum.BUFFER_SIZE)
                    var totalWritten = 0L
                    while (true) {
                        val read = stream.read(buffer)
                        if (read == -1) break
                        sink.write(buffer, 0, read)
                        totalWritten += read
                        onProgress((totalWritten.toFloat() / sizeBytes).coerceIn(0f, 1f))
                    }
                }
            }
        }

        val request = MediaUploadRequest.build(uploadUrl, contentType, body)

        try {
            storageClient.newCall(request).execute().use { response ->
                response.isSuccessful || response.code == 412
            }
        } catch (_: Exception) {
            false
        }
    }
}
