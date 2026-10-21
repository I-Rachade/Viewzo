import { LiveLeadStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LeadStatusDto {
  @IsEnum(LiveLeadStatus)
  status!: LiveLeadStatus;
}

export class ManualItemDto {
  @IsUUID('4')
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  variant?: string;
}

export class ManualLeadDto {
  // Which live of the offer; defaults to the only one running.
  @IsOptional()
  @IsUUID('4')
  sessionId?: string;

  @IsString()
  @Matches(/^@?[A-Za-z0-9._]{2,24}$/, {
    message: 'Nom d’utilisateur TikTok invalide',
  })
  tiktokUser!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ManualItemDto)
  items?: ManualItemDto[];
}

export class StaffCancelLiveDto {
  @IsString()
  @MaxLength(300)
  @Matches(/\S{3,}/, { message: 'Donne une raison' })
  reason!: string;
}
