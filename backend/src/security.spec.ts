import { checkProductionConfig } from './config-check';
import { normalizeHandle } from './connections/connections.service';
import { TokenCrypto } from './connections/token-crypto';
import { expand } from './posts/view-counters';

const strong = (c: string) => c.repeat(40);
const safe = {
  NODE_ENV: 'production',
  PAYMENT_MODE: 'live',
  OTP_PROVIDER: 'didit',
  MAIL_PROVIDER: 'cloudflare',
  JWT_SECRET: strong('a'),
  OTP_SECRET: strong('b'),
  TOKEN_ENCRYPTION_KEY: strong('c'),
};

describe('checkProductionConfig', () => {
  it('accepts safe production settings and ignores development', () => {
    expect(() => checkProductionConfig(safe)).not.toThrow();
    expect(() =>
      checkProductionConfig({ NODE_ENV: 'development', PAYMENT_MODE: 'local' }),
    ).not.toThrow();
  });

  it.each([
    [{ PAYMENT_MODE: 'local' }, /PAYMENT_MODE=local/],
    [{ OTP_PROVIDER: 'local' }, /OTP_PROVIDER/],
    [{ MAIL_PROVIDER: '' }, /MAIL_PROVIDER/],
    [{ JWT_SECRET: 'short' }, /JWT_SECRET/],
    [{ TOKEN_ENCRYPTION_KEY: strong('a') }, /must differ/],
  ])('refuses %o', (change, message) => {
    expect(() => checkProductionConfig({ ...safe, ...change })).toThrow(
      message,
    );
  });

  it('allows free payments only when asked for explicitly', () => {
    expect(() =>
      checkProductionConfig({
        ...safe,
        PAYMENT_MODE: 'local',
        ALLOW_TEST_PAYMENTS: 'yes',
      }),
    ).not.toThrow();
  });
});

describe('normalizeHandle', () => {
  it.each([
    ['@Ama', 'ama'],
    ['https://www.tiktok.com/@Ama/', 'ama'],
    ['https://instagram.com/ama?igsh=x', 'ama'],
    [' ama ', 'ama'],
  ])('%s → %s', (raw, handle) => {
    expect(normalizeHandle(raw)).toBe(handle);
  });
});

describe('TokenCrypto', () => {
  it('reads tokens sealed with an older key after a key change', () => {
    const sealed = new TokenCrypto('old-key').encrypt('secret-token');
    const rotated = new TokenCrypto('new-key', ['old-key']);
    expect(rotated.decrypt(sealed)).toBe('secret-token');
    expect(() => new TokenCrypto('new-key').decrypt(sealed)).toThrow();
  });
});

describe('expand', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const redirectTo = (location: string) =>
    jest
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 301, headers: { location } }),
      );

  it('never requests a link that is not a known short link', async () => {
    global.fetch = jest.fn();
    await expect(expand('http://169.254.169.254/latest')).resolves.toBe(
      'http://169.254.169.254/latest',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('follows a short link to the network', async () => {
    global.fetch = redirectTo(
      'https://www.tiktok.com/@ama/video/123',
    ).mockResolvedValueOnce(
      new Response(null, {
        status: 301,
        headers: { location: 'https://www.tiktok.com/@ama/video/123' },
      }),
    );
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    await expect(expand('https://vm.tiktok.com/ZM123/')).resolves.toBe(
      'https://www.tiktok.com/@ama/video/123',
    );
  });

  it('stops at a redirect that leaves the network', async () => {
    global.fetch = redirectTo('http://10.0.0.5/admin');
    await expect(expand('https://vm.tiktok.com/ZM123/')).resolves.toBe(
      'https://vm.tiktok.com/ZM123/',
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
