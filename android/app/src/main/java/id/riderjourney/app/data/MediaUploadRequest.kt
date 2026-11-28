package id.riderjourney.app.data

import okhttp3.Request
import okhttp3.RequestBody

/**
 * A presigned PUT signs a fixed header set. Sending anything else — most of
 * all an Authorization or x-amz-* header from an interceptor — breaks SigV4,
 * so the storage client has no auth interceptor and this builder sets exactly
 * the two signed headers.
 */
object MediaUploadRequest {
    const val CONTENT_TYPE = "Content-Type"
    const val IF_NONE_MATCH = "If-None-Match"

    fun build(uploadUrl: String, contentType: String, body: RequestBody): Request =
        Request.Builder()
            .url(uploadUrl)
            .put(body)
            .header(CONTENT_TYPE, contentType)
            .header(IF_NONE_MATCH, "*")
            .build()
}
