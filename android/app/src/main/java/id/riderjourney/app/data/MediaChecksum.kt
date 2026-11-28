package id.riderjourney.app.data

import java.io.InputStream
import java.security.MessageDigest

/**
 * SHA-256 helpers kept free of Android types so they can be unit tested on the JVM.
 * Both functions stream through a fixed buffer: a 100 MB video never lands in RAM.
 */
object MediaChecksum {
    const val BUFFER_SIZE = 8192
    const val MAX_UPLOAD_BYTES = 100L * 1024 * 1024

    fun sha256Hex(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun countBytes(input: InputStream): Long {
        val buffer = ByteArray(BUFFER_SIZE)
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            total += read
        }
        return total
    }

    /** Presigned intents live minutes; a stored URL past this margin must be re-issued. */
    fun needsNewIntent(expiresAtMs: Long, nowMs: Long, marginMs: Long = 60_000L): Boolean =
        expiresAtMs - marginMs <= nowMs
}
