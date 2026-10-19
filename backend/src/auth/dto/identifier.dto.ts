import { IsString, Length, Matches } from 'class-validator';
import { IsPassword } from './password.decorator';

// An email address or a phone number.
export class IdentifierDto {
  @IsString()
  @Length(6, 254)
  identifier!: string;
}

export class IdentifierCodeDto extends IdentifierDto {
  @Matches(/^\d{6}$/, { message: 'Le code contient 6 chiffres' })
  code!: string;
}

export class LoginDto extends IdentifierDto {
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class ResetPasswordDto extends IdentifierCodeDto {
  @IsPassword()
  password!: string;
}
