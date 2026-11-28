import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUrl, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

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
  // An empty string clears the avatar; anything else must be a http(s) URL.
  @ValidateIf((dto: UpdateProfileDto) => dto.avatarUrl !== '')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsIn(['public', 'followers', 'private'])
  visibility?: 'public' | 'followers' | 'private';

  /** Link avatar to a ready media asset. Set empty string to clear. */
  @IsOptional()
  @ValidateIf((dto: UpdateProfileDto) => dto.avatarMediaId !== '')
  @IsUUID()
  avatarMediaId?: string;
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
