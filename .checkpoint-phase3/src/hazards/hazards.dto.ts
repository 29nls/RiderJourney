import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const HAZARD_KINDS = ['road_damage', 'accident', 'congestion', 'police', 'weather', 'obstacle', 'other'] as const;

export class GeoPointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class CreateHazardDto {
  @IsIn(HAZARD_KINDS)
  kind!: (typeof HAZARD_KINDS)[number];

  @ValidateNested()
  @Type(() => GeoPointDto)
  location!: GeoPointDto;

  @IsISO8601({ strict: true })
  observedAt!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @IsOptional()
  @IsUUID()
  photoMediaId?: string;

  /** A shorter window only; the server clamps it to the configured default. */
  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(86_400)
  ttlSeconds?: number;

  @IsOptional()
  @IsBoolean()
  sameAsNearby?: boolean;

  @IsOptional()
  @IsUUID()
  mergeIntoId?: string;
}

export class NearbyQueryDto {
  @IsNumber()
  @Type(() => Number)
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Type(() => Number)
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(100)
  @Max(10_000)
  radiusM?: number;

  @IsOptional()
  @IsIn(['24h', '7d'])
  since?: '24h' | '7d';
}

export class ConfirmHazardDto {
  @IsIn(['still_present', 'not_relevant'])
  verdict!: 'still_present' | 'not_relevant';

  @IsOptional()
  @IsString()
  @Length(0, 280)
  note?: string;
}

export class ReportHazardDto {
  @IsIn(['spam', 'false_safety', 'inappropriate', 'other'])
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class HazardPhotoDto {
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(5_242_880)
  sizeBytes!: number;
}
