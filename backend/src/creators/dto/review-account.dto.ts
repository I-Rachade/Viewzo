import { AccountStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const REVIEW_DECISIONS = [
  AccountStatus.ELIGIBLE,
  AccountStatus.NEEDS_FIX,
  AccountStatus.NOT_ELIGIBLE,
  AccountStatus.SUSPENDED,
] as const;

export class ReviewAccountDto {
  @IsIn(REVIEW_DECISIONS)
  status!: (typeof REVIEW_DECISIONS)[number];

  // Shown to the creator: the action to take, the reason, or the suspension motive.
  @ValidateIf((o: ReviewAccountDto) => o.status !== AccountStatus.ELIGIBLE)
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  followers?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  avgStatusViews?: number;
}
