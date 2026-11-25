package id.riderjourney.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import id.riderjourney.app.ui.components.MessageBanner
import id.riderjourney.app.ui.components.SectionCard

private enum class AuthMode { LOGIN, REGISTER, RESET_REQUEST, RESET_CONFIRM }

@Composable
fun AuthScreen(viewModel: SessionViewModel) {
    val state = viewModel.uiState
    var mode by rememberSaveable { mutableStateOf(AuthMode.LOGIN) }
    var email by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var resetToken by rememberSaveable { mutableStateOf("") }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("RiderJourney", style = MaterialTheme.typography.headlineLarge)
            Text(
                "Catat touring, simpan rute, dan kelola kendaraan dalam satu tempat.",
                style = MaterialTheme.typography.bodyLarge,
            )

            SectionCard(
                title = when (mode) {
                    AuthMode.LOGIN -> "Masuk"
                    AuthMode.REGISTER -> "Buat akun"
                    AuthMode.RESET_REQUEST -> "Lupa kata sandi"
                    AuthMode.RESET_CONFIRM -> "Atur ulang kata sandi"
                },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (state.error != null) MessageBanner(state.error, isError = true)
                    if (state.notice != null) MessageBanner(state.notice, isError = false)

                    if (mode == AuthMode.REGISTER) {
                        OutlinedTextField(
                            value = displayName,
                            onValueChange = { displayName = it },
                            label = { Text("Nama tampilan") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = username,
                            onValueChange = { username = it },
                            label = { Text("Nama pengguna") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (mode != AuthMode.RESET_CONFIRM) {
                        OutlinedTextField(
                            value = email,
                            onValueChange = { email = it },
                            label = { Text("Email") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (mode == AuthMode.RESET_CONFIRM) {
                        OutlinedTextField(
                            value = resetToken,
                            onValueChange = { resetToken = it },
                            label = { Text("Token reset") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (mode == AuthMode.LOGIN || mode == AuthMode.REGISTER || mode == AuthMode.RESET_CONFIRM) {
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            label = { Text(if (mode == AuthMode.RESET_CONFIRM) "Kata sandi baru" else "Kata sandi") },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    if (state.busy) {
                        CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                    } else {
                        Button(
                            onClick = {
                                when (mode) {
                                    AuthMode.LOGIN -> viewModel.login(email, password)
                                    AuthMode.REGISTER -> viewModel.register(email, username, displayName, password)
                                    AuthMode.RESET_REQUEST -> viewModel.requestReset(email)
                                    AuthMode.RESET_CONFIRM -> viewModel.confirmReset(resetToken, password)
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = email.isNotBlank() && (mode == AuthMode.RESET_REQUEST || mode == AuthMode.RESET_CONFIRM || password.isNotBlank()),
                        ) {
                            Text(
                                when (mode) {
                                    AuthMode.LOGIN -> "Masuk"
                                    AuthMode.REGISTER -> "Daftar"
                                    AuthMode.RESET_REQUEST -> "Kirim permintaan"
                                    AuthMode.RESET_CONFIRM -> "Simpan kata sandi"
                                },
                            )
                        }
                    }

                    when (mode) {
                        AuthMode.LOGIN -> {
                            TextButton(onClick = { mode = AuthMode.REGISTER; viewModel.clearMessages() }) {
                                Text("Belum punya akun? Daftar")
                            }
                            TextButton(onClick = { mode = AuthMode.RESET_REQUEST; viewModel.clearMessages() }) {
                                Text("Lupa kata sandi?")
                            }
                        }
                        AuthMode.RESET_REQUEST -> {
                            OutlinedButton(
                                onClick = { mode = AuthMode.RESET_CONFIRM; viewModel.clearMessages() },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text("Saya sudah punya token") }
                            TextButton(onClick = { mode = AuthMode.LOGIN; viewModel.clearMessages() }) { Text("Kembali masuk") }
                        }
                        else -> TextButton(onClick = { mode = AuthMode.LOGIN; viewModel.clearMessages() }) {
                            Text("Kembali masuk")
                        }
                    }
                }
            }
        }
    }
}
