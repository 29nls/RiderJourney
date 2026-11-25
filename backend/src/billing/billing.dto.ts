import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsOptional, IsString, Length, ValidateNested,
} from 'class-validator';

export class VerifyPurchaseDto {
  @IsString()
  @Length(20, 4096)
  purchaseToken!: string;

  @IsString()
  @Length(1, 120)
  productId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  basePlanId?: string;

  @IsString()
  @Length(2, 40)
  planCode!: string;
}

export class RestoreItemDto {
  @IsString()
  @Length(20, 4096)
  purchaseToken!: string;

  @IsString()
  @Length(1, 120)
  productId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  basePlanId?: string;
}

export class RestorePurchasesDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RestoreItemDto)
  purchases!: RestoreItemDto[];
}
