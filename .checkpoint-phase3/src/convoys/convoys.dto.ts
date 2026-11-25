import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class GeoPointDto {
  @Min(-90)
  @Max(90)
  lat!: number;

  @Min(-180)
  @Max(180)
  lng!: number;
}

export class ConvoyWaypointDto extends GeoPointDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  label?: string;
}

export class CreateConvoyDto {
  @IsString()
  @Length(3, 80)
  name!: string;

  @ValidateNested()
  @Type(() => GeoPointDto)
  meetingPoint!: GeoPointDto;

  @ValidateNested()
  @Type(() => GeoPointDto)
  destination!: GeoPointDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => ConvoyWaypointDto)
  waypoints?: ConvoyWaypointDto[];

  @IsOptional()
  @IsISO8601({ strict: true })
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(100)
  capacity?: number;

  @IsOptional()
  @IsIn(['draft', 'lobby'])
  status?: 'draft' | 'lobby';

  @IsOptional()
  @IsUUID()
  routeId?: string;
}

export class JoinConvoyDto {
  @IsString()
  @Length(8, 64)
  code!: string;
}

export class CreateInviteDto {
  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(604_800)
  expiresInSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxUses?: number;
}

export class UpdateConvoyRouteDto {
  @IsUUID()
  routeId!: string;
}

export class ChangeMemberRoleDto {
  @IsIn(['co_leader', 'member'])
  role!: 'co_leader' | 'member';
}

export class TransferLeadershipDto {
  @IsUUID()
  userId!: string;
}

export class RejectMemberDto {
  @IsOptional()
  @IsString()
  @Length(0, 240)
  reason?: string;
}

export class UpdateSharingDto {
  @IsIn([true, false])
  sharingConsent!: boolean;
}

export class RealtimeTicketDto {
  @IsUUID()
  convoyId!: string;
}
