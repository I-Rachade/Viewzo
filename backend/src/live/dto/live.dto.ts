import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLiveDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title!: string;

  // TikTok usernames: letters, digits, dots and underscores.
  @IsString()
  @Matches(/^@?[A-Za-z0-9._]{2,24}$/, {
    message: 'Nom d’utilisateur TikTok invalide',
  })
  tiktokUsername!: string;

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;

  // Products of the day; empty means all active products.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  productIds?: string[];
}

export class UpdateLiveDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/^@?[A-Za-z0-9._]{2,24}$/, {
    message: 'Nom d’utilisateur TikTok invalide',
  })
  tiktokUsername?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  productIds?: string[];
}
