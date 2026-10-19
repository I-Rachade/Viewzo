import { ProfileType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ActivateProfileDto {
  @IsEnum(ProfileType)
  type!: ProfileType;
}
