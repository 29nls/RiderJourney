import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class PointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class WaypointDto extends PointDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}

export class RoutePreviewDto {
  @ValidateNested()
  @Type(() => PointDto)
  origin!: PointDto;

  @ValidateNested()
  @Type(() => PointDto)
  destination!: PointDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WaypointDto)
  waypoints?: WaypointDto[];

  @IsOptional()
  @IsBoolean()
  alternatives?: boolean;
}
