import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { parsePhone } from './phone';

// What a person types to sign up or log in: an email address or a phone number.
export type Identifier =
  | { kind: 'email'; value: string }
  | { kind: 'phone'; value: string; country: string };

export function parseIdentifier(
  input: string,
  defaultRegion: string,
): Identifier {
  const trimmed = input.trim();
  if (trimmed.includes('@')) {
    const value = trimmed.toLowerCase();
    if (!isEmail(value)) {
      throw new BadRequestException('Adresse e-mail invalide');
    }
    return { kind: 'email', value };
  }
  const { e164, country } = parsePhone(trimmed, defaultRegion);
  return { kind: 'phone', value: e164, country };
}
