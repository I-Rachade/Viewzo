import { BadRequestException } from '@nestjs/common';
import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

export interface ParsedPhone {
  e164: string;
  country: string;
}

export function parsePhone(input: string, defaultRegion: string): ParsedPhone {
  const parsed = parsePhoneNumberFromString(
    input,
    defaultRegion as CountryCode,
  );
  if (!parsed || !parsed.isValid() || !parsed.country) {
    throw new BadRequestException('Numéro de téléphone invalide');
  }
  return { e164: parsed.number, country: parsed.country };
}
