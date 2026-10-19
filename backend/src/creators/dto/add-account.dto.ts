import { SocialNetwork } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class AddAccountDto {
  @IsEnum(SocialNetwork)
  network!: SocialNetwork;

  // Handle or profile link; for WhatsApp Statut the phone number used.
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  handle!: string;
}
