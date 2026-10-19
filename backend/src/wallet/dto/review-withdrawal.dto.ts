import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewWithdrawalDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
