import { LiveSaleStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ReviewLiveDto {
  @IsIn([LiveSaleStatus.ACTIVE, LiveSaleStatus.REJECTED])
  status!: 'ACTIVE' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class PayoutDecisionDto {
  @IsIn(['PAY', 'REFUSE'])
  decision!: 'PAY' | 'REFUSE';

  // The audience the team accepts, when it differs from what was read.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  peakViewers?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class LiveRateDto {
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  advertiserPer100!: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  creatorPer100!: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  selfFee!: number;
}
