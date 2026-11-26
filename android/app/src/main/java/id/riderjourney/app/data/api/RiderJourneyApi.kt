package id.riderjourney.app.data.api

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface RiderJourneyApi {
    @POST("v1/auth/register")
    suspend fun register(@Body request: RegisterRequest): AuthResponse

    @POST("v1/auth/login")
    suspend fun login(@Body request: LoginRequest): AuthResponse

    @POST("v1/auth/refresh")
    suspend fun refresh(@Body request: RefreshRequest): RefreshResponse

    @POST("v1/auth/logout")
    suspend fun logout(@Body request: RefreshRequest)

    @POST("v1/auth/password/reset/request")
    suspend fun requestReset(@Body request: ResetRequest)

    @POST("v1/auth/password/reset/confirm")
    suspend fun confirmReset(@Body request: ResetConfirmRequest)

    @GET("v1/auth/session")
    suspend fun session(): MeDto

    @GET("v1/me")
    suspend fun me(): MeDto

    @PATCH("v1/me")
    suspend fun updateProfile(@Body request: UpdateProfileRequest): MeDto

    @GET("v1/me/settings")
    suspend fun settings(): SettingsDto

    @PATCH("v1/me/settings")
    suspend fun updateSettings(@Body request: UpdateSettingsRequest): SettingsDto

    @GET("v1/vehicles")
    suspend fun vehicles(): VehicleListDto

    @POST("v1/vehicles")
    suspend fun createVehicle(@Body request: VehicleRequest): VehicleDto

    @GET("v1/vehicles/{id}")
    suspend fun vehicle(@Path("id") id: String, @Query("includePlate") includePlate: Boolean = false): VehicleDto

    @PATCH("v1/vehicles/{id}")
    suspend fun updateVehicle(@Path("id") id: String, @Body request: VehicleRequest): VehicleDto

    @DELETE("v1/vehicles/{id}")
    suspend fun deleteVehicle(@Path("id") id: String)

    @POST("v1/vehicles/{id}/primary")
    suspend fun primaryVehicle(@Path("id") id: String): VehicleDto

    @GET("v1/places/search")
    suspend fun searchPlaces(@Query("q") query: String, @Query("limit") limit: Int = 8): PlaceListDto

    @POST("v1/routes/preview")
    suspend fun previewRoute(@Body request: RoutePreviewRequest): RoutePreviewResponse

    @GET("v1/routes/{id}")
    suspend fun route(@Path("id") id: String): RouteDetailDto

    @POST("v1/routes/{id}/recalculate")
    suspend fun recalculateRoute(@Path("id") id: String): RouteOptionDto

    @GET("v1/trips")
    suspend fun trips(@Query("limit") limit: Int = 20): TripListDto

    @GET("v1/trips/active")
    suspend fun activeTrip(): ActiveTripDto

    @POST("v1/trips")
    suspend fun startTrip(@Body request: StartTripRequest): TripDto

    @GET("v1/trips/{id}")
    suspend fun trip(@Path("id") id: String): TripDto

    @POST("v1/trips/{id}/pause")
    suspend fun pauseTrip(@Path("id") id: String): TripDto

    @POST("v1/trips/{id}/resume")
    suspend fun resumeTrip(@Path("id") id: String): TripDto

    @POST("v1/trips/{id}/finish")
    suspend fun finishTrip(@Path("id") id: String): TripDto

    @POST("v1/trips/{id}/points")
    suspend fun addTripPoints(@Path("id") id: String, @Body request: TripPointsRequest): TripPointsResponse

    @GET("v1/trips/{id}/points")
    suspend fun tripPoints(@Path("id") id: String, @Query("limit") limit: Int = 200): TripPointListDto

    @GET("v1/convoys/active")
    suspend fun activeConvoy(): ActiveConvoyDto

    @GET("v1/convoys")
    suspend fun convoys(): ConvoyListDto

    @POST("v1/convoys")
    suspend fun createConvoy(@Body request: ConvoyCreateRequest): ConvoyDto

    @POST("v1/convoys/join")
    suspend fun joinConvoy(@Body request: ConvoyJoinRequest): ConvoyDto

    @GET("v1/convoys/{id}")
    suspend fun convoy(@Path("id") id: String): ConvoyDto

    @GET("v1/convoys/{id}/members")
    suspend fun convoyMembers(@Path("id") id: String): ConvoyMemberListDto

    @GET("v1/convoys/{id}/positions")
    suspend fun convoyPositions(@Path("id") id: String): ConvoyPositionListDto

    @PATCH("v1/convoys/{id}/sharing")
    suspend fun convoySharing(@Path("id") id: String, @Body request: ConvoySharingRequest)

    @POST("v1/convoys/{id}/start")
    suspend fun startConvoy(@Path("id") id: String, @Header("If-Match") ifMatch: String? = null)

    @POST("v1/convoys/{id}/pause")
    suspend fun pauseConvoy(@Path("id") id: String, @Header("If-Match") ifMatch: String? = null)

    @POST("v1/convoys/{id}/resume")
    suspend fun resumeConvoy(@Path("id") id: String, @Header("If-Match") ifMatch: String? = null)

    @POST("v1/convoys/{id}/complete")
    suspend fun completeConvoy(@Path("id") id: String, @Header("If-Match") ifMatch: String? = null)

    @POST("v1/convoys/{id}/cancel")
    suspend fun cancelConvoy(@Path("id") id: String, @Header("If-Match") ifMatch: String? = null)

    @POST("v1/convoys/{id}/leave")
    suspend fun leaveConvoy(@Path("id") id: String, @Header("If-Match") ifMatch: String? = null)

    @POST("v1/convoys/{id}/members/{userId}/approve")
    suspend fun approveConvoyMember(
        @Path("id") id: String,
        @Path("userId") userId: String,
        @Header("If-Match") ifMatch: String? = null,
    )

    @POST("v1/convoys/{id}/members/{userId}/reject")
    suspend fun rejectConvoyMember(
        @Path("id") id: String,
        @Path("userId") userId: String,
        @Header("If-Match") ifMatch: String? = null,
    )

    @DELETE("v1/convoys/{id}/members/{userId}")
    suspend fun removeConvoyMember(
        @Path("id") id: String,
        @Path("userId") userId: String,
        @Header("If-Match") ifMatch: String? = null,
    )

    @PATCH("v1/convoys/{id}/members/{userId}")
    suspend fun changeConvoyRole(
        @Path("id") id: String,
        @Path("userId") userId: String,
        @Body request: ConvoyRoleRequest,
        @Header("If-Match") ifMatch: String? = null,
    )

    @POST("v1/convoys/{id}/transfer")
    suspend fun transferConvoy(
        @Path("id") id: String,
        @Body request: ConvoyTransferRequest,
        @Header("If-Match") ifMatch: String? = null,
    )

    @PATCH("v1/convoys/{id}/route")
    suspend fun updateConvoyRoute(
        @Path("id") id: String,
        @Body request: ConvoyRouteRequest,
        @Header("If-Match") ifMatch: String? = null,
    )

    @GET("v1/convoys/{id}/invites")
    suspend fun convoyInvites(@Path("id") id: String): ConvoyInviteListDto

    @POST("v1/convoys/{id}/invites")
    suspend fun createConvoyInvite(@Path("id") id: String, @Body request: ConvoyCreateInviteRequest): ConvoyInviteDto

    @DELETE("v1/convoys/{id}/invites/{inviteId}")
    suspend fun revokeConvoyInvite(@Path("id") id: String, @Path("inviteId") inviteId: String)

    @POST("v1/realtime/ticket")
    suspend fun realtimeTicket(@Body request: RealtimeTicketRequest): RealtimeTicketDto

    @GET("v1/convoys/{id}/messages")
    suspend fun convoyMessages(
        @Path("id") id: String,
        @Query("limit") limit: Int = 20,
        @Query("before") before: String? = null,
    ): MessagePageDto

    @POST("v1/convoys/{id}/messages")
    suspend fun sendConvoyMessage(@Path("id") id: String, @Body request: SendMessageRequest): MessageDto

    @GET("v1/hazards/nearby")
    suspend fun nearbyHazards(
        @Query("lat") lat: Double,
        @Query("lng") lng: Double,
        @Query("radiusM") radiusM: Int = 3000,
    ): HazardListDto

    @POST("v1/hazards")
    suspend fun createHazard(@Body request: CreateHazardRequest): HazardDto

    @POST("v1/hazards/{id}/confirm")
    suspend fun confirmHazard(@Path("id") id: String, @Body request: ConfirmHazardRequest): HazardConfirmDto

    @POST("v1/hazards/{id}/report")
    suspend fun reportHazard(@Path("id") id: String, @Body request: HazardReportRequest)
}
