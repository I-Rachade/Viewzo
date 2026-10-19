import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiditOtpService } from './didit-otp.service';

describe('DiditOtpService', () => {
  const service = new DiditOtpService(
    new ConfigService({ DIDIT_API_KEY: 'test-key' }),
  );
  let fetchMock: jest.SpyInstance;

  function respond(status: number, body: object) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    );
  }

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('sends the code by SMS with the API key', async () => {
    respond(200, { status: 'Success' });
    await service.request('+22890123456');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://verification.didit.me/v3/phone/send/');
    expect(init.headers).toMatchObject({ 'x-api-key': 'test-key' });
    expect(JSON.parse(init.body as string)).toEqual({
      phone_number: '+22890123456',
      options: { code_size: 6, locale: 'fr', preferred_channel: 'sms' },
    });
  });

  it('refuses a blocked send', async () => {
    respond(200, { status: 'Blocked', reason: 'suspicious' });
    await expect(service.request('+22890123456')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('maps rate limiting to 429', async () => {
    respond(429, { detail: 'too many' });
    await expect(service.request('+22890123456')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('accepts an approved code', async () => {
    respond(200, { status: 'Approved' });
    await expect(
      service.verify('+22890123456', '123456'),
    ).resolves.toBeUndefined();
  });

  it.each(['Failed', 'Declined', 'Expired or Not Found'])(
    'rejects a %s check',
    async (status) => {
      respond(200, { status });
      await expect(service.verify('+22890123456', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    },
  );

  it('reports provider outages as 503', async () => {
    respond(502, { code: 'phone_provider_unavailable' });
    await expect(
      service.verify('+22890123456', '123456'),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('reports network errors as 503', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(service.request('+22890123456')).rejects.toMatchObject({
      status: 503,
    });
  });
});
