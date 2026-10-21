import { DisputeOutcome, DisputeStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class OpenDisputeDto {
  // What is contested and why, read by the team.
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class DecideDisputeDto {
  @IsEnum(DisputeOutcome)
  outcome!: DisputeOutcome;

  // Shown to both sides.
  @IsString()
  @Length(3, 500)
  reason!: string;

  // New total of validated views, for SET_VIEWS.
  @ValidateIf((o: DecideDisputeDto) => o.outcome === DisputeOutcome.SET_VIEWS)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  views?: number;
}

export class DisputeFiltersDto {
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}
