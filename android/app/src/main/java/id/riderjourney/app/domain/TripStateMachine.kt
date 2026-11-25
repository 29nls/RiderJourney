package id.riderjourney.app.domain

enum class TripState { ACTIVE, PAUSED, FINISHED }

enum class TripEvent { PAUSE, RESUME, FINISH }

object TripStateMachine {
    fun transition(current: TripState, event: TripEvent): TripState? = when (current) {
        TripState.ACTIVE -> when (event) {
            TripEvent.PAUSE -> TripState.PAUSED
            TripEvent.FINISH -> TripState.FINISHED
            TripEvent.RESUME -> null
        }
        TripState.PAUSED -> when (event) {
            TripEvent.RESUME -> TripState.ACTIVE
            TripEvent.FINISH -> TripState.FINISHED
            TripEvent.PAUSE -> null
        }
        TripState.FINISHED -> null
    }

    fun fromApi(status: String): TripState? = when (status) {
        "active" -> TripState.ACTIVE
        "paused" -> TripState.PAUSED
        "finished" -> TripState.FINISHED
        else -> null
    }
}
