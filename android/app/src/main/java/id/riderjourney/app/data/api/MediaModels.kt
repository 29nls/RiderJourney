package id.riderjourney.app.data.api

import kotlinx.serialization.Serializable

@Serializable
data class CreateUploadRequest(
    val purpose: String,
    val contentType: String,
    val sizeBytes: Long,
    val clientMediaId: String,
    val checksumSha256: String,
)

@Serializable
data class UploadIntentResponse(
    val id: String,
    val status: String,
    val uploadUrl: String? = null,
    val method: String? = null,
    val requiredHeaders: Map<String, String>? = null,
    val expiresIn: Int? = null,
    val duplicate: Boolean = false,
    val note: String? = null,
)

@Serializable
data class UploadCompleteResponse(
    val id: String,
    val status: String,
    val purpose: String? = null,
    /** unscanned | clean | quarantined | scan_failed — other users only see clean media. */
    val scanStatus: String? = null,
    val duplicate: Boolean = false,
)

@Serializable
data class DeleteMediaResponse(
    val id: String,
    /** deleting | deleted */
    val status: String,
    val duplicate: Boolean = false,
)

@Serializable
data class MediaErrorBody(
    val code: String? = null,
    val detail: String? = null,
    val references: List<String> = emptyList(),
)

@Serializable
data class SignedUrlResponse(
    val id: String,
    val mimeType: String? = null,
    val sizeBytes: Long? = null,
    val expiresAt: String? = null,
    val expiresIn: Int? = null,
    val url: String? = null,
)

@Serializable
data class MediaAccessResponse(
    val id: String,
    val mimeType: String? = null,
    val sizeBytes: Long? = null,
    val purpose: String? = null,
    val expiresAt: String? = null,
    val downloadUrl: String? = null,
    val downloadExpiresIn: Int? = null,
)

@Serializable
data class StorageQuotaResponse(
    val quotaBytes: Long = 0,
    /** ready + deletion-pending: bytes still stored and still charged. */
    val usedBytes: Long = 0,
    val readyBytes: Long = 0,
    val deletionPendingBytes: Long = 0,
    val reservedBytes: Long = 0,
    val availableBytes: Long = 0,
)
