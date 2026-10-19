import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayinRequest, PaymentGateway, PayoutRequest, str } from './gateway';

// Development and tests (PAYMENT_MODE=local): every payment succeeds at once.
@Injectable()
export class LocalGateway implements PaymentGateway {
  readonly name = 'local';

  constructor(private readonly config: ConfigService) {}

  createPayin(req: PayinRequest) {
    const web = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
    return Promise.resolve({
      checkoutUrl: `${web.split(',')[0]}/payments/return?reference=${req.reference}`,
      providerRef: `local-${req.reference}`,
    });
  }

  checkPayin() {
    return Promise.resolve({ status: 'SUCCEEDED' as const });
  }

  createPayout(req: PayoutRequest) {
    return Promise.resolve({
      status: 'SUCCEEDED' as const,
      providerRef: `local-${req.reference}`,
    });
  }

  checkPayout() {
    return Promise.resolve({ status: 'SUCCEEDED' as const });
  }

  webhookRef(body: Record<string, unknown>) {
    return { reference: str(body.reference) };
  }
}
