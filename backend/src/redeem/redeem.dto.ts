import { IsString, Length } from 'class-validator';

export class RedeemDto {
  @IsString()
  @Length(4, 40)
  code!: string;

  /** Client-generated so a timeout retry cannot consume two quota slots. */
  @IsString()
  @Length(8, 80)
  idempotencyKey!: string;
}
