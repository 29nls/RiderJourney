import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min,
} from 'class-validator';

export class CreateAlbumDto {
  @IsString()
  @Length(8, 80)
  clientAlbumId!: string;

  @IsString()
  @Length(1, 80)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsIn(['public', 'followers', 'community', 'private'])
  visibility!: 'public' | 'followers' | 'community' | 'private';

  @IsOptional()
  @IsUUID()
  communityId?: string;
}

export class AddAlbumMediaDto {
  @IsUUID()
  mediaId!: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  caption?: string;

  @IsOptional()
  @IsISO8601()
  takenAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20_000)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20_000)
  height?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationS?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortIndex?: number;
}

export class UpdateAlbumMediaDto {
  @IsOptional()
  @IsString()
  @Length(0, 300)
  caption?: string;

  @IsOptional()
  @IsISO8601()
  takenAt?: string;
}

export class ReviewAlbumMediaDto {
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';
}

export class AlbumListQueryDto {
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
