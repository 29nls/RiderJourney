package id.riderjourney.app.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okio.BufferedSink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream

class MediaChecksumTest {
    @Test
    fun `sha256 matches known vector`() {
        val hash = MediaChecksum.sha256Hex(ByteArrayInputStream("abc".toByteArray()))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hash)
    }

    @Test
    fun `sha256 streams payload larger than buffer`() {
        val payload = ByteArray(MediaChecksum.BUFFER_SIZE * 3 + 17) { (it % 251).toByte() }
        val expected = java.security.MessageDigest.getInstance("SHA-256")
            .digest(payload)
            .joinToString("") { "%02x".format(it) }
        assertEquals(expected, MediaChecksum.sha256Hex(ByteArrayInputStream(payload)))
    }

    @Test
    fun `countBytes reads the whole stream`() {
        assertEquals(100_000L, MediaChecksum.countBytes(ByteArrayInputStream(ByteArray(100_000))))
    }

    @Test
    fun `expired or imminently expiring intent needs a new one`() {
        assertFalse(MediaChecksum.needsNewIntent(expiresAtMs = 10_000_000, nowMs = 1_000_000))
        assertTrue(MediaChecksum.needsNewIntent(expiresAtMs = 1_030_000, nowMs = 1_000_000))
        assertTrue(MediaChecksum.needsNewIntent(expiresAtMs = 500_000, nowMs = 1_000_000))
    }

    @Test
    fun `presigned put sends only the signed headers`() {
        val body = object : RequestBody() {
            override fun contentType() = "image/jpeg".toMediaType()
            override fun contentLength() = 0L
            override fun writeTo(sink: BufferedSink) = Unit
        }
        val request = MediaUploadRequest.build("https://s3.example/bucket/key?sig=abc", "image/jpeg", body)

        assertEquals("PUT", request.method)
        assertEquals("https://s3.example/bucket/key?sig=abc", request.url.toString())
        assertEquals("image/jpeg", request.header(MediaUploadRequest.CONTENT_TYPE))
        assertEquals("*", request.header(MediaUploadRequest.IF_NONE_MATCH))
        assertNull(request.header("Authorization"))
        assertEquals(
            setOf(MediaUploadRequest.CONTENT_TYPE, MediaUploadRequest.IF_NONE_MATCH),
            request.headers.names(),
        )
    }

    @Test
    fun `zero length input hashes without reading past end`() {
        val empty: InputStream = ByteArrayInputStream(ByteArray(0))
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            MediaChecksum.sha256Hex(empty),
        )
    }
}
