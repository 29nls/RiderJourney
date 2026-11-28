package id.riderjourney.app.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import id.riderjourney.app.data.MediaRepository

@EntryPoint
@InstallIn(SingletonComponent::class)
interface MediaEntryPoint {
    fun mediaRepository(): MediaRepository
}

@Composable
fun rememberMediaRepository(): MediaRepository {
    val context = LocalContext.current.applicationContext
    return remember(context) {
        EntryPointAccessors.fromApplication(context, MediaEntryPoint::class.java).mediaRepository()
    }
}

/**
 * Displays a stored media asset through `/v1/media/:id/url` → signed access,
 * never through a permanent public URL. Every load (cache miss) mints a fresh
 * signed URL, so a revoked or expired URL is recovered by recomposition.
 */
@Composable
fun MediaImage(
    mediaId: String?,
    contentDescription: String,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    fallback: @Composable () -> Unit,
) {
    val repository = rememberMediaRepository()
    var bitmap by remember(mediaId) { mutableStateOf<Bitmap?>(null) }

    LaunchedEffect(mediaId) {
        bitmap = null
        if (mediaId.isNullOrBlank()) return@LaunchedEffect
        bitmap = repository.loadImage(mediaId).getOrNull()
    }

    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        val image = bitmap
        if (image != null) {
            Image(
                bitmap = image.asImageBitmap(),
                contentDescription = contentDescription,
                modifier = Modifier.matchParentSize(),
                contentScale = contentScale,
            )
        } else {
            fallback()
        }
    }
}
