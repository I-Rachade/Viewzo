import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class FundCampaignDto {
  // WALLET: from the available balance. MOBILE_MONEY: through the provider.
  @IsIn(['WALLET', 'MOBILE_MONEY'])
  method!: 'WALLET' | 'MOBILE_MONEY';

  // Mobile Money number to pay with; the account's number by default.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}
