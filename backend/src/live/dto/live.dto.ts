import { LiveMode } from '@prisma/client';
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
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const TIKTOK_USERNAME = /^@?[A-Za-z0-9._]{2,24}$/;

export class CreateLiveDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title!: string;

  // CREATORS by default: creators accept the offer and sell in their lives.
  @IsOptional()
  @IsEnum(LiveMode)
  mode?: LiveMode;

  // The shop's WhatsApp number buyers write to with their code.
  @IsString()
  @Matches(/^\+?[\d\s.-]{8,20}$/, { message: 'Numéro WhatsApp invalide' })
  whatsapp!: string;

  // CREATORS: start of the period. SELF: the planned time.
  @IsDateString()
  startsAt!: string;

  @ValidateIf((o: CreateLiveDto) => o.mode !== LiveMode.SELF)
  @IsDateString()
  endsAt?: string;

  @ValidateIf((o: CreateLiveDto) => o.mode !== LiveMode.SELF)
  @IsInt()
  @Min(1)
  @Max(50)
  slots?: number;

  // FCFA held in escrow; each creator earns at most budget / slots.
  @ValidateIf((o: CreateLiveDto) => o.mode !== LiveMode.SELF)
  @IsInt()
  @Min(1_000)
  @Max(100_000_000)
  budget?: number;

  @ValidateIf((o: CreateLiveDto) => o.mode !== LiveMode.SELF)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Matches(/^[A-Z]{2}$/, { each: true })
  countries?: string[];

  // SELF only: the advertiser's own TikTok account.
  @ValidateIf((o: CreateLiveDto) => o.mode === LiveMode.SELF)
  @IsString()
  @Matches(TIKTOK_USERNAME, { message: 'Nom d’utilisateur TikTok invalide' })
  tiktokUsername?: string;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;

  // Products of the offer; empty means all active products.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  productIds?: string[];
}

export class InviteDto {
  @IsUUID('4')
  creatorId!: string;
}

export class AcceptLiveDto {
  // Hour the creator plans their live, inside the offer's period.
  @IsDateString()
  scheduledAt!: string;
}

export class RespondInviteDto {
  @IsBoolean()
  accept!: boolean;

  @ValidateIf((o: RespondInviteDto) => o.accept)
  @IsDateString()
  scheduledAt?: string;
}
