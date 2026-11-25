import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsIn(['public', 'followers', 'private'])
  visibility?: 'public' | 'followers' | 'private';
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  locationSharingDefault?: boolean;

  @IsOptional()
  @IsIn(['private', 'followers', 'public'])
  tripHistoryVisibility?: 'private' | 'followers' | 'public';

  @IsOptional()
  @IsObject()
  notificationPreferences?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  audioPreferences?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  mapPreferences?: Record<string, unknown>;
}

export class ConsentDto {
  @IsIn(['terms', 'privacy', 'location_disclosure', 'microphone_disclosure'])
  kind!: 'terms' | 'privacy' | 'location_disclosure' | 'microphone_disclosure';

  @IsString()
  @MaxLength(40)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  context?: string;
}
