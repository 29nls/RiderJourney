import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional,
  IsString, IsUUID, Length, Max, Min, ValidateNested,
} from 'class-validator';

const REACTIONS = ['like', 'love', 'respect', 'laugh'] as const;

export class PostLocationDto {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;
}

export class CreatePostDto {
  @IsString()
  @Length(8, 80)
  clientPostId!: string;

  @IsIn(['text', 'photo', 'video', 'trip_recap'])
  kind!: 'text' | 'photo' | 'video' | 'trip_recap';

  @IsIn(['public', 'followers', 'community', 'private'])
  audience!: 'public' | 'followers' | 'community' | 'private';

  @IsOptional()
  @IsUUID()
  communityId?: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  caption?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  mediaIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PostLocationDto)
  location?: PostLocationDto;
}

export class PostListQueryDto {
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

export class ReactDto {
  @IsIn(REACTIONS)
  kind!: (typeof REACTIONS)[number];

  @IsString()
  @Length(8, 80)
  clientId!: string;
}

export class CreateCommentDto {
  @IsString()
  @Length(8, 80)
  clientId!: string;

  @IsString()
  @Length(1, 1000)
  body!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class CommentReactionDto {
  @IsIn(REACTIONS)
  kind!: (typeof REACTIONS)[number];

  @IsString()
  @Length(8, 80)
  clientId!: string;
}
