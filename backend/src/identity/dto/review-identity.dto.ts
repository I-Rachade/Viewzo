import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewIdentityDto {
  @IsIn(['APPROVE', 'DECLINE'])
  decision!: 'APPROVE' | 'DECLINE';

  // Shown to the person when the check is declined.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
