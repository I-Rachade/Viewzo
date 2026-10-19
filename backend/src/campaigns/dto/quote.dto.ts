import { CampaignPackage, SocialNetwork } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

// Query string for the live platform picker: ?package=PRO&budget=70000&platforms=TIKTOK,INSTAGRAM
export class QuoteDto {
  @IsEnum(CampaignPackage)
  package!: CampaignPackage;

  @Transform(({ value }) => Number(value), { toClassOnly: true })
  @IsInt()
  @Min(0)
  budget!: number;

  @IsOptional()
  @Transform(
    ({ value }: { value: string }) =>
      value ? value.split(',').filter(Boolean) : [],
    { toClassOnly: true },
  )
  @IsArray()
  @IsEnum(SocialNetwork, { each: true })
  platforms?: SocialNetwork[];
}
