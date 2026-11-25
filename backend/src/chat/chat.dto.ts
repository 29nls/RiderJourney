import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class SendMessageDto {
  @IsString()
  @Length(8, 80)
  clientMessageId!: string;

  @IsIn(['text', 'location', 'waypoint'])
  kind!: 'text' | 'location' | 'waypoint';

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  body?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;
}

export class MessagePageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  before?: string;
}

export class ReportMessageDto {
  @IsIn(['spam', 'harassment', 'false_safety', 'inappropriate', 'other'])
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class ChatMessageEnvelopeDto {
  @ValidateNested()
  @Type(() => SendMessageDto)
  data!: SendMessageDto;
}
