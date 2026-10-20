import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewWithdrawalDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ResolvePayoutDto {
  @IsIn(['SUCCEEDED', 'FAILED'])
  outcome!: 'SUCCEEDED' | 'FAILED';

  // What finance saw at the provider; kept in the audit journal.
  @IsString()
  @MaxLength(300)
  reason!: string;
}
