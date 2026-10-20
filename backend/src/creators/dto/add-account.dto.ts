import { SocialNetwork } from '@prisma/client';
import {
  Equals,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AddAccountDto {
  @IsEnum(SocialNetwork)
  network!: SocialNetwork;

  // Account name (@name) or profile link; for WhatsApp Statut the phone number used.
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  handle!: string;

  // Followers the creator says they have; viewers per status for WhatsApp Statut.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  followers?: number;

  // Anonymous accounts are not allowed: the creator confirms it is theirs.
  @Equals(true, {
    message: 'Confirme que le compte est à toi et n’est pas anonyme',
  })
  notAnonymous!: boolean;
}
