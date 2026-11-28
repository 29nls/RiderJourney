package id.riderjourney.app.ui

import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import id.riderjourney.app.data.MediaRepository
import id.riderjourney.app.data.VehicleRepository
import id.riderjourney.app.data.api.VehicleDto
import id.riderjourney.app.data.api.VehicleRequest
import kotlinx.coroutines.launch
import javax.inject.Inject

data class GarageUiState(
    val vehicles: List<VehicleDto> = emptyList(),
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val revealedPlates: Map<String, String> = emptyMap(),
    val uploadProgress: Float? = null,
)

@HiltViewModel
class GarageViewModel @Inject constructor(
    private val repository: VehicleRepository,
    private val media: MediaRepository,
) : ViewModel() {
    var uiState by mutableStateOf(GarageUiState())
        private set

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            uiState = uiState.copy(loading = true, error = null)
            repository.list().fold(
                onSuccess = { uiState = uiState.copy(loading = false, vehicles = it) },
                onFailure = { uiState = uiState.copy(loading = false, error = it.message) },
            )
        }
    }

    fun create(request: VehicleRequest) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            repository.create(request).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = "Kendaraan ditambahkan.")
                    load()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun update(id: String, request: VehicleRequest) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null)
            repository.update(id, request).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = "Kendaraan diperbarui.")
                    load()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun setPrimary(id: String) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            repository.setPrimary(id).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false)
                    load()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun delete(id: String) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            repository.delete(id).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = "Kendaraan dihapus.")
                    load()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    /** Upload a photo then link it to the vehicle with the existing PATCH endpoint. */
    fun uploadPhoto(vehicle: VehicleDto, uri: Uri) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null, notice = null, uploadProgress = 0f)
            media.uploadImage(uri, "vehicle_photo") { progress ->
                uiState = uiState.copy(uploadProgress = progress)
            }.fold(
                onSuccess = { entity ->
                    val mediaId = entity.mediaId
                    if (mediaId == null) {
                        uiState = uiState.copy(busy = false, uploadProgress = null, error = "Upload selesai tanpa media ID.")
                        return@fold
                    }
                    repository.update(
                        vehicle.id,
                        VehicleRequest(
                            type = vehicle.type,
                            brand = vehicle.brand,
                            model = vehicle.model,
                            year = vehicle.year,
                            engineCc = vehicle.engineCc,
                            nickname = vehicle.nickname,
                            photoMediaId = mediaId,
                        ),
                    ).fold(
                        onSuccess = {
                            uiState = uiState.copy(busy = false, uploadProgress = null, notice = "Foto kendaraan diperbarui.")
                            load()
                        },
                        onFailure = { uiState = uiState.copy(busy = false, uploadProgress = null, error = it.message) },
                    )
                },
                onFailure = { uiState = uiState.copy(busy = false, uploadProgress = null, error = it.message) },
            )
        }
    }

    fun removePhoto(vehicle: VehicleDto) {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, error = null)
            repository.update(
                vehicle.id,
                VehicleRequest(
                    type = vehicle.type,
                    brand = vehicle.brand,
                    model = vehicle.model,
                    year = vehicle.year,
                    engineCc = vehicle.engineCc,
                    nickname = vehicle.nickname,
                    photoMediaId = "",
                ),
            ).fold(
                onSuccess = {
                    uiState = uiState.copy(busy = false, notice = "Foto kendaraan dihapus.")
                    load()
                },
                onFailure = { uiState = uiState.copy(busy = false, error = it.message) },
            )
        }
    }

    fun revealPlate(id: String) {
        viewModelScope.launch {
            repository.detail(id, includePlate = true).fold(
                onSuccess = { vehicle ->
                    val plate = vehicle.plate
                    if (plate != null) {
                        uiState = uiState.copy(revealedPlates = uiState.revealedPlates + (id to plate))
                    } else {
                        uiState = uiState.copy(error = "Nomor polisi tidak tersedia.")
                    }
                },
                onFailure = { uiState = uiState.copy(error = it.message) },
            )
        }
    }

    fun clearMessages() {
        uiState = uiState.copy(error = null, notice = null)
    }
}
