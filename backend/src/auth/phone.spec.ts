import { BadRequestException } from '@nestjs/common';
import { parsePhone } from './phone';

describe('parsePhone', () => {
  it('normalises an international number and detects the country', () => {
    expect(parsePhone('+228 90 12 34 56', 'TG')).toEqual({
      e164: '+22890123456',
      country: 'TG',
    });
  });

  it('uses the default region for local numbers', () => {
    expect(parsePhone('90 12 34 56', 'TG').e164).toBe('+22890123456');
  });

  it('detects other countries from the prefix', () => {
    expect(parsePhone('+229 01 97 00 00 00', 'TG').country).toBe('BJ');
  });

  it('rejects invalid numbers', () => {
    expect(() => parsePhone('123', 'TG')).toThrow(BadRequestException);
  });
});
