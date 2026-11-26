package id.riderjourney.app.ui

import id.riderjourney.app.data.api.MessageDto
import id.riderjourney.app.data.api.MessageSenderDto
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatMergeTest {
    private fun message(id: String, at: String, body: String) = MessageDto(
        id = id,
        clientMessageId = "client-$id",
        sender = MessageSenderDto(id = "u1", displayName = "Rider"),
        body = body,
        createdAt = at,
    )

    @Test
    fun `merging a page that overlaps the loaded window keeps one copy and sorts by time`() {
        val existing = listOf(
            message("b", "2026-11-26T02:00:00.000Z", "second"),
            message("c", "2026-11-26T03:00:00.000Z", "third"),
        )
        val older = listOf(
            message("a", "2026-11-26T01:00:00.000Z", "first"),
            message("b", "2026-11-26T02:00:00.000Z", "second"),
        )

        val merged = mergeMessages(existing, older)

        assertEquals(listOf("a", "b", "c"), merged.map { it.id })
        assertEquals(3, merged.size)
    }

    @Test
    fun `a resend that returns the stored row does not duplicate it`() {
        val sent = message("srv-1", "2026-11-26T04:00:00.000Z", "hello")

        val merged = mergeMessages(listOf(sent), listOf(sent))

        assertEquals(1, merged.size)
        assertEquals("srv-1", merged.first().id)
    }
}
