package id.riderjourney.app.e2e

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import id.riderjourney.app.data.api.VehicleDto
import id.riderjourney.app.data.api.VehicleRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Garage journeys: add a vehicle, attach a photo, see the reference come back
 * from the list, replace it, clear it, and confirm a photo still referenced by
 * a vehicle cannot be deleted out from under it.
 */
@RunWith(AndroidJUnit4::class)
class VehicleMediaE2ETest {

    @Before
    fun clearStoredSession() = E2e.clearSession()

    @After
    fun leaveNoSession() = E2e.clearSession()

    private fun newVehicle(photoMediaId: String? = null): VehicleDto = E2e.block {
        E2e.graph.vehicleRepository().create(
            VehicleRequest(
                type = "motorcycle",
                brand = "Honda",
                model = "CB650R",
                year = 2024,
                engineCc = 649,
                nickname = "E2E",
                photoMediaId = photoMediaId,
            ),
        ).getOrThrow()
    }

    private fun update(vehicle: VehicleDto, photoMediaId: String?): VehicleDto = E2e.block {
        E2e.graph.vehicleRepository().update(
            vehicle.id,
            VehicleRequest(
                type = vehicle.type,
                brand = vehicle.brand,
                model = vehicle.model,
                year = vehicle.year,
                engineCc = vehicle.engineCc,
                nickname = vehicle.nickname,
                photoMediaId = photoMediaId,
            ),
        ).getOrThrow()
    }

    @Test
    fun addingAVehicleWithAPhotoStoresTheReference() {
        E2e.registerAccount("vehicle-add")
        val mediaId = E2e.upload(E2e.pngFixture("vehicle-add"), "vehicle_photo")
        val vehicle = newVehicle(mediaId)

        assertEquals("create echoes the photo reference", mediaId, vehicle.photoMediaId)
        assertEquals("motorcycle", vehicle.type)
    }

    @Test
    fun garageListReportsTheVehiclePhoto() {
        E2e.registerAccount("vehicle-list")
        val mediaId = E2e.upload(E2e.pngFixture("vehicle-list"), "vehicle_photo")
        val created = newVehicle(mediaId)

        val listed = E2e.block { E2e.graph.vehicleRepository().list().getOrThrow() }
            .first { it.id == created.id }
        assertEquals(mediaId, listed.photoMediaId)
    }

    @Test
    fun replacingTheVehiclePhotoSwapsTheReference() {
        E2e.registerAccount("vehicle-replace")
        val first = E2e.upload(E2e.pngFixture("vehicle-first"), "vehicle_photo")
        val vehicle = newVehicle(first)

        val second = E2e.upload(E2e.pngFixture("vehicle-second"), "vehicle_photo")
        val updated = update(vehicle, second)

        assertEquals(second, updated.photoMediaId)
        val listed = E2e.block { E2e.graph.vehicleRepository().list().getOrThrow() }.first { it.id == vehicle.id }
        assertEquals("the old reference is not kept alongside", second, listed.photoMediaId)
    }

    @Test
    fun clearingTheVehiclePhotoRemovesTheReference() {
        E2e.registerAccount("vehicle-clear")
        val mediaId = E2e.upload(E2e.pngFixture("vehicle-clear"), "vehicle_photo")
        val vehicle = newVehicle(mediaId)

        val cleared = update(vehicle, "")
        assertNull("vehicle no longer points at a photo", cleared.photoMediaId)
    }

    @Test
    fun aPhotoStillUsedByAVehicleCannotBeDeleted() {
        E2e.registerAccount("vehicle-inuse")
        val mediaId = E2e.upload(E2e.pngFixture("vehicle-inuse"), "vehicle_photo")
        newVehicle(mediaId)

        val result = E2e.block { E2e.graph.mediaRepository().deleteMedia(mediaId) }
        assertTrue("deletion is refused while a vehicle still references the media", result.isFailure)
    }
}
