import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(24)
  @Matches(/^[a-z0-9][a-z0-9._]{1,22}[a-z0-9]$/, {
    message: 'username harus 3-24 karakter, huruf kecil, angka, titik, atau garis bawah',
  })
  username!: string;

  @IsString()
  @Length(1, 60)
  displayName!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class TokenDto {
  @IsString()
  @MinLength(20)
  token!: string;
}

export class ResetRequestDto {
  @IsEmail()
  email!: string;
}

export class ResetConfirmDto {
  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  newPassword!: string;
}
