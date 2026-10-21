import { CampaignFilePurpose } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class UploadCampaignFileDto {
  // An element for the creators, or the advertiser's voice or video brief.
  @IsOptional()
  @IsEnum(CampaignFilePurpose)
  purpose: CampaignFilePurpose = CampaignFilePurpose.ASSET;
}
