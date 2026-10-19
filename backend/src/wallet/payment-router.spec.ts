import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CinetpayGateway } from './gateways/cinetpay.gateway';
import { FedapayGateway } from './gateways/fedapay.gateway';
import { FlutterwaveGateway } from './gateways/flutterwave.gateway';
import { GatewayError } from './gateways/gateway';
import { LocalGateway } from './gateways/local.gateway';
import { PaymentRouter } from './payment-router';

function router(env: Record<string, string>) {
  const config = new ConfigService(env);
  return new PaymentRouter(
    config,
    new LocalGateway(config),
    new FedapayGateway(config),
    new CinetpayGateway(config),
    new FlutterwaveGateway(config),
  );
}

describe('PaymentRouter', () => {
  // ConfigService reads process.env first; CI runs with PAYMENT_MODE=local.
  const saved = process.env.PAYMENT_MODE;
  beforeAll(() => delete process.env.PAYMENT_MODE);
  afterAll(() => {
    if (saved !== undefined) process.env.PAYMENT_MODE = saved;
  });

  it('routes by country: FedaPay, CinetPay, then Flutterwave', () => {
    const r = router({});
    expect(r.providerFor('TG')).toBe('fedapay');
    expect(r.providerFor('BJ')).toBe('fedapay');
    expect(r.providerFor('CI')).toBe('cinetpay');
    expect(r.providerFor('NG')).toBe('flutterwave');
    expect(r.providerFor('FR')).toBe('flutterwave');
  });

  it('follows PAYMENT_ROUTES and never uses the test gateway in production', () => {
    const r = router({ PAYMENT_ROUTES: 'TG:cinetpay,*:fedapay' });
    expect(r.providerFor('TG')).toBe('cinetpay');
    expect(r.providerFor('GH')).toBe('fedapay');
    expect(() => r.byName('local')).toThrow(GatewayError);
    expect(router({ PAYMENT_MODE: 'local' }).providerFor('TG')).toBe('local');
  });

  it('refuses a payment when the provider keys are missing', async () => {
    await expect(
      router({})
        .byName('fedapay')
        .checkPayin({ reference: 'x', providerRef: 'tx:1' }),
    ).rejects.toThrow(GatewayError);
  });

  it('reads which payment a webhook is about', () => {
    const r = router({ FLUTTERWAVE_WEBHOOK_HASH: 'secret-hash' });
    expect(
      r
        .byName('fedapay')
        .webhookRef({ name: 'transaction.approved', entity: { id: 42 } }, {}),
    ).toEqual({ providerRef: 'tx:42' });
    expect(
      r
        .byName('fedapay')
        .webhookRef({ name: 'payout.sent', entity: { id: 7 } }, {}),
    ).toEqual({ providerRef: 'po:7' });
    expect(
      r.byName('cinetpay').webhookRef({ cpm_trans_id: 'VZPAB' }, {}),
    ).toEqual({ reference: 'VZPAB' });
    const flutterwave = r.byName('flutterwave');
    expect(
      flutterwave.webhookRef(
        { data: { tx_ref: 'VZPCD' } },
        { 'verif-hash': 'secret-hash' },
      ),
    ).toEqual({ reference: 'VZPCD' });
    expect(() =>
      flutterwave.webhookRef(
        { data: { tx_ref: 'VZPCD' } },
        { 'verif-hash': 'nope' },
      ),
    ).toThrow(UnauthorizedException);
  });
});
