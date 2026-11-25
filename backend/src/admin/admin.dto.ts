import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID,
  Length, Max, Min, ValidateNested,
} from 'class-validator';

const REASON = { min: 3, max: 500 } as const;

export class ListQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UserStatusDto {
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';

  @IsString()
  @Length(REASON.min, REASON.max)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  note?: string;
}

export class ResolveReportDto {
  @IsIn(['reviewed', 'actioned', 'dismissed'])
  status!: 'reviewed' | 'actioned' | 'dismissed';

  @IsString()
  @Length(REASON.min, REASON.max)
  reason!: string;
}

export class PostModerationDto {
  @IsIn(['hide', 'restore', 'remove'])
  action!: 'hide' | 'restore' | 'remove';

  @IsString()
  @Length(REASON.min, REASON.max)
  reason!: string;
}

export class CommunityModerationDto {
  @IsIn(['hide', 'restore', 'remove'])
  action!: 'hide' | 'restore' | 'remove';

  @IsString()
  @Length(REASON.min, REASON.max)
  reason!: string;
}

export class GrantSubscriptionDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @Length(2, 40)
  planCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days!: number;

  @IsString()
  @Length(REASON.min, REASON.max)
  reason!: string;
}

export class CreateRedeemDto {
  @IsIn(['points', 'subscription_days', 'poster_template'])
  rewardKind!: 'points' | 'subscription_days' | 'poster_template';

  @IsObject()
  rewardValue!: Record<string, unknown>;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  quotaTotal!: number;

  @IsOptional()
  @IsString()
  @Length(10, 40)
  expiresAt?: string;

  @IsString()
  @Length(REASON.min, REASON.max)
  reason!: string;
}

export class RedeemActionDto {
  @IsString()
  @Length(REASON.min, REASON.max)
  reason!: string;
}

export class UpdateConfigDto {
  @IsString()
  @Length(2, 80)
  key!: string;

  @IsObject()
  value!: Record<string, unknown>;

  @IsString()
  @Length(REASON.min, REASON.max)
  reason!: string;
}

export class ConfirmMfaDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  action?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  actor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
