import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  headline?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  homeRegion?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  bio?: string;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @IsOptional()
  @IsIn(['public', 'followers', 'private'])
  feedVisibility?: 'public' | 'followers' | 'private';

  @IsOptional()
  @IsBoolean()
  leaderboardOptIn?: boolean;
}

export class ReportContentDto {
  @IsIn(['post', 'comment', 'user', 'album', 'media', 'message', 'hazard', 'community_event'])
  targetType!: 'post' | 'comment' | 'user' | 'album' | 'media' | 'message' | 'hazard' | 'community_event';

  @IsUUID()
  targetId!: string;

  @IsIn([
    'spam', 'harassment', 'false_safety', 'inappropriate', 'other', 'hate', 'sexual',
    'violence', 'self_harm', 'misinformation', 'dangerous_riding', 'impersonation',
  ])
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  detail?: string;

  @IsString()
  @Length(8, 80)
  clientReportId!: string;
}

export class CursorPageQueryDto {
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
