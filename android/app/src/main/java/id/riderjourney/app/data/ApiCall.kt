package id.riderjourney.app.data

import id.riderjourney.app.data.api.ErrorBodyDto
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException

data class AppError(val code: String, val message: String)

suspend fun <T> apiCall(json: Json, block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (error: HttpException) {
    val parsed = runCatching {
        json.decodeFromString(ErrorBodyDto.serializer(), error.response()?.errorBody()?.string().orEmpty())
    }.getOrNull()
    Result.failure(ApiException(parsed?.code ?: "HTTP_${error.code()}", parsed?.detail ?: "Permintaan gagal."))
} catch (error: ApiException) {
    Result.failure(error)
} catch (error: IOException) {
    Result.failure(ApiException("NETWORK_ERROR", "Tidak dapat terhubung ke server."))
} catch (error: Exception) {
    Result.failure(ApiException("CLIENT_ERROR", error.message ?: "Terjadi kesalahan."))
}

class ApiException(val code: String, override val message: String) : Exception(message)
