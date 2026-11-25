import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class NotificationListQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  cursor?: string;
}

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  mention?: boolean;

  @IsOptional()
  @IsBoolean()
  comment?: boolean;

  @IsOptional()
  @IsBoolean()
  follow?: boolean;

  @IsOptional()
  @IsBoolean()
  hazard?: boolean;

  @IsOptional()
  @IsBoolean()
  quietNav?: boolean;
}

export class RegisterPushDeviceDto {
  @IsString()
  @Length(16, 4096)
  token!: string;

  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';

  @IsString()
  @Length(8, 80)
  clientDeviceId!: string;
}
