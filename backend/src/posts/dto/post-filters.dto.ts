import { PostReviewStatus, SocialNetwork } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class PostFiltersDto {
  @IsOptional()
  // ONLINE_CHECK: validated posts due for their 30-day check.
  @IsIn([...Object.values(PostReviewStatus), 'ALL', 'ONLINE_CHECK'])
  status?: PostReviewStatus | 'ALL' | 'ONLINE_CHECK';

  @IsOptional()
  @IsEnum(SocialNetwork)
  network?: SocialNetwork;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  // Campaign code (#VZ123), creator number or e-mail.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['risk', 'date'])
  sort?: 'risk' | 'date';
}
