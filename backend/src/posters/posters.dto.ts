import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreatePosterDto {
  @IsIn(['first_light', 'peloton_lines', 'night_odometer'])
  template!: 'first_light' | 'peloton_lines' | 'night_odometer';

  @IsString()
  @Length(1, 80)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  subtitle?: string;

  @IsString()
  @Length(8, 80)
  clientPosterId!: string;
}
