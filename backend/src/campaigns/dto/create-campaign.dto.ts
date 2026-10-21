import {
  CampaignObjective,
  CampaignPackage,
  ContentCase,
  ContentType,
  NoAssetsChoice,
  SocialNetwork,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CampaignPlatformDto {
  @IsEnum(SocialNetwork)
  network!: SocialNetwork;

  @IsEnum(ContentType)
  contentType!: ContentType;

  // Advertiser's own split; the automatic proposal is used when left out.
  @IsOptional()
  @IsInt()
  @Min(1)
  budget?: number;
}

export class CreateCampaignDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title!: string;

  @IsEnum(CampaignObjective)
  objective!: CampaignObjective;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @Matches(/^[A-Z]{2}$/, { each: true, message: 'Code pays invalide' })
  countries!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  cities?: string[];

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsEnum(CampaignPackage)
  package!: CampaignPackage;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  budget!: number;

  // In the order the advertiser added them.
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CampaignPlatformDto)
  platforms!: CampaignPlatformDto[];

  // Saved without sending: the advertiser comes back to it later.
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  // « Qu'apportes-tu pour le contenu ? »
  @IsEnum(ContentCase)
  contentCase!: ContentCase;

  // Files sent beforehand with POST /me/campaign-files.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  fileIds?: string[];

  // Voice or video brief, sent the same way.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsUUID('all', { each: true })
  briefFileIds?: string[];

  // Extra links, a shared folder for instance.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ require_protocol: true }, { each: true })
  assetUrls?: string[];

  @IsOptional()
  @IsEnum(NoAssetsChoice)
  noAssetsChoice?: NoAssetsChoice;

  // The one thing people must remember.
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  keyMessage!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  callToAction?: string;

  // Text to put under the post.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  // Sound or music to use, by name or link.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sound?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  productDetails?: string;

  @IsOptional()
  @IsBoolean()
  shipsProduct?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  productPickup?: string;

  @IsOptional()
  @IsBoolean()
  faceRequired?: boolean;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  language!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  minDurationSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  maxDurationSec?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  mandatoryElements?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  forbiddenElements?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({ require_protocol: true }, { each: true })
  examples?: string[];
}
