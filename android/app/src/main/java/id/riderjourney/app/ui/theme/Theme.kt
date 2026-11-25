package id.riderjourney.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
    primary = Color(0xFF1F5B4A),
    onPrimary = Color.White,
    secondary = Color(0xFFB05A2A),
    surface = Color(0xFFF8F6F1),
    background = Color(0xFFF8F6F1),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8ED4BA),
    onPrimary = Color(0xFF00382B),
    secondary = Color(0xFFFFB68E),
    surface = Color(0xFF151714),
    background = Color(0xFF151714),
)

@Composable
fun RiderJourneyTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colors = when {
        Build.VERSION.SDK_INT >= 31 -> if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(colorScheme = colors, content = content)
}
