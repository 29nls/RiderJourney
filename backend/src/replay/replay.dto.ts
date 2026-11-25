import {
  ArrayMaxSize, IsArray, IsISO8601, IsNumber, IsOptional, IsUUID, Max, Min,
} from 'class-validator';

export class CreateTripPhotoDto {
  @IsUUID()
  mediaId!: string;

  @IsNumber()
  @Min(0)
  @Max(2_000_000)
  positionM!: number;

  @IsOptional()
  @IsISO8601()
  takenAt?: string;
}

export class ShareTripDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  userIds!: string[];
}
