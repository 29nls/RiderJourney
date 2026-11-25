package id.riderjourney.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TripStateMachineTest {
    @Test
    fun `active trip can pause`() {
        assertEquals(TripState.PAUSED, TripStateMachine.transition(TripState.ACTIVE, TripEvent.PAUSE))
    }

    @Test
    fun `active trip can finish`() {
        assertEquals(TripState.FINISHED, TripStateMachine.transition(TripState.ACTIVE, TripEvent.FINISH))
    }

    @Test
    fun `paused trip can resume`() {
        assertEquals(TripState.ACTIVE, TripStateMachine.transition(TripState.PAUSED, TripEvent.RESUME))
    }

    @Test
    fun `paused trip can finish`() {
        assertEquals(TripState.FINISHED, TripStateMachine.transition(TripState.PAUSED, TripEvent.FINISH))
    }

    @Test
    fun `invalid transitions are rejected`() {
        assertNull(TripStateMachine.transition(TripState.ACTIVE, TripEvent.RESUME))
        assertNull(TripStateMachine.transition(TripState.PAUSED, TripEvent.PAUSE))
        assertNull(TripStateMachine.transition(TripState.FINISHED, TripEvent.RESUME))
        assertNull(TripStateMachine.transition(TripState.FINISHED, TripEvent.FINISH))
    }

    @Test
    fun `api status maps to local state`() {
        assertEquals(TripState.ACTIVE, TripStateMachine.fromApi("active"))
        assertEquals(TripState.PAUSED, TripStateMachine.fromApi("paused"))
        assertEquals(TripState.FINISHED, TripStateMachine.fromApi("finished"))
        assertNull(TripStateMachine.fromApi("unknown"))
    }
}
