import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** National number and country of an E.164 number, as providers want them. */
export function phoneParts(e164: string) {
  const parsed = parsePhoneNumberFromString(e164);
  return {
    national: parsed?.nationalNumber ?? e164.replace(/^\+/, ''),
    countryCallingCode: parsed?.countryCallingCode ?? '',
    digits: e164.replace(/\D/g, ''),
  };
}

/** "Kossi Ama Mensah" → firstname "Kossi", lastname "Ama Mensah". */
export function splitName(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { firstname: first, lastname: rest.join(' ') || first };
}
