package id.riderjourney.app.data.api

import kotlinx.serialization.Serializable

@Serializable
data class ErrorBodyDto(val code: String? = null, val detail: String? = null, val title: String? = null)
