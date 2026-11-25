import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const MEDIA_PURPOSES = [
  'hazard_photo', 'community_logo', 'community_cover', 'avatar',
  'post_photo', 'post_video', 'album_photo', 'album_video', 'poster',
] as const;

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;

export class CreateUploadDto {
  @IsIn(MEDIA_PURPOSES)
  purpose!: (typeof MEDIA_PURPOSES)[number];

  @IsIn([...IMAGE_TYPES, ...VIDEO_TYPES])
  contentType!: (typeof IMAGE_TYPES)[number] | (typeof VIDEO_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(104_857_600)
  sizeBytes!: number;

  /** Client-generated, so a retry after a lost response reuses the same row and key. */
  @IsString()
  @Length(8, 80)
  clientMediaId!: string;

  @IsOptional()
  @IsString()
  checksumSha256?: string;
}

export class CompleteUploadDto {
  // Multipart fields arrive as strings; coercion keeps the same integer bound.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(104_857_600)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  originalName?: string;
}
