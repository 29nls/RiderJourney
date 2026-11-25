import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateCommunityDto {
  @IsString()
  @Length(3, 40)
  @Matches(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/, {
    message: 'slug hanya boleh berisi huruf, angka, dan tanda hubung tunggal',
  })
  slug!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  region?: string;

  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';
}

export class SetCommunityRoleDto {
  @IsIn(['admin', 'moderator', 'member'])
  role!: 'admin' | 'moderator' | 'member';
}
