import { ProfileType } from '@prisma/client';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { IsPassword } from './password.decorator';

export class RegisterCompleteDto {
  @IsString()
  ticket!: string;

  @IsPassword()
  password!: string;

  // The starting role; the other one can be added later in the profile.
  @IsIn([ProfileType.CREATOR, ProfileType.ADVERTISER])
  role!: ProfileType;

  // Required for email sign-ups; a phone number carries its own country.
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string;
}
