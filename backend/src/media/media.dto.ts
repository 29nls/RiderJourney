import { IsIn, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

export const MEDIA_PURPOSES = [
  'hazard_photo', 'community_logo', 'community_cover', 'avatar',
  'post_photo', 'post_video', 'album_photo', 'album_video', 'poster', 'vehicle_photo',
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

  /**
   * Hex SHA-256 of the bytes the client intends to upload. Required: completion
   * compares this with a digest the server computes from the stored object, so
   * neither the size nor the content is taken on trust.
   */
  @Matches(/^[0-9a-fA-F]{64}$/, { message: 'checksumSha256 must be 64 hex characters' })
  checksumSha256!: string;
}
