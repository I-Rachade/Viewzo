import { applyDecorators } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';

// At least 8 characters with a letter and a digit.
export function IsPassword() {
  return applyDecorators(
    IsString(),
    Length(8, 128, {
      message: 'Le mot de passe doit contenir au moins 8 caractères',
    }),
    Matches(/[A-Za-z]/, {
      message: 'Le mot de passe doit contenir au moins une lettre',
    }),
    Matches(/\d/, {
      message: 'Le mot de passe doit contenir au moins un chiffre',
    }),
  );
}
