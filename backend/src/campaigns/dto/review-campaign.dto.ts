import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';

export class ReviewCampaignDto {
  @IsIn(['ACTIVE', 'REJECTED'])
  status!: 'ACTIVE' | 'REJECTED';

  // Shown to the advertiser when the campaign is rejected.
  @ValidateIf((o: ReviewCampaignDto) => o.status === 'REJECTED')
  @IsString()
  @MaxLength(500)
  reason?: string;
}
