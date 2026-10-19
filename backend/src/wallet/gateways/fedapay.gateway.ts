import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  callProvider,
  GatewayStatus,
  PayinRequest,
  PaymentGateway,
  PayoutRequest,
  StoredPayment,
  secret,
  str,
} from './gateway';
import { phoneParts, splitName } from './phone-parts';

// https://docs.fedapay.com/api-reference
// Transactions and payouts have separate id sequences, so the stored
// providerRef is prefixed: "tx:123" or "po:456".
@Injectable()
export class FedapayGateway implements PaymentGateway {
  readonly name = 'fedapay';
  private readonly logger = new Logger(FedapayGateway.name);

  constructor(private readonly config: ConfigService) {}

  async createPayin(req: PayinRequest) {
    const { national } = phoneParts(req.phone);
    const created = unwrap(
      await this.call('POST', '/transactions', {
        description: req.description,
        amount: req.amount,
        currency: { iso: req.currency },
        callback_url: req.returnUrl,
        merchant_reference: req.reference,
        customer: {
          firstname: 'Client',
          lastname: 'Viewzo',
          phone_number: {
            number: national,
            country: req.country.toLowerCase(),
          },
        },
      }),
      'transaction',
    );
    const id = str(created.id);
    const token = await this.call<{ url?: string }>(
      'POST',
      `/transactions/${id}/token`,
      {},
    );
    return { checkoutUrl: token.url ?? '', providerRef: `tx:${id}` };
  }

  async checkPayin(payment: StoredPayment) {
    const tx = unwrap(
      await this.call('GET', `/transactions/${id(payment)}`),
      'transaction',
    );
    const status = str(tx.status);
    return {
      status: payinStatus(status),
      amount: Number(tx.amount),
      reason: status,
    };
  }

  async createPayout(req: PayoutRequest) {
    const { national } = phoneParts(req.phone);
    const payout = unwrap(
      await this.call('POST', '/payouts', {
        amount: req.amount,
        currency: { iso: req.currency },
        mode: 'mobile_money',
        merchant_reference: req.reference,
        customer: {
          ...splitName(req.beneficiaryName),
          phone_number: {
            number: national,
            country: req.country.toLowerCase(),
          },
        },
      }),
      'payout',
    );
    const payoutId = str(payout.id);
    await this.call('PUT', '/payouts/start', { payouts: [{ id: payoutId }] });
    return { status: 'PROCESSING' as const, providerRef: `po:${payoutId}` };
  }

  async checkPayout(payment: StoredPayment) {
    const payout = unwrap(
      await this.call('GET', `/payouts/${id(payment)}`),
      'payout',
    );
    const status = str(payout.status);
    const result: GatewayStatus =
      status === 'sent'
        ? 'SUCCEEDED'
        : status === 'failed'
          ? 'FAILED'
          : 'PROCESSING';
    return { status: result, reason: str(payout.last_error_code) ?? status };
  }

  webhookRef(body: Record<string, unknown>) {
    const entity = (body.entity ?? body.object ?? {}) as Record<
      string,
      unknown
    >;
    const entityId = str(entity.id);
    if (!entityId) return null;
    const prefix = (str(body.name) ?? '').startsWith('payout') ? 'po' : 'tx';
    return { providerRef: `${prefix}:${entityId}` };
  }

  private call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: object,
  ) {
    const base =
      this.config.get('FEDAPAY_ENV') === 'live'
        ? 'https://api.fedapay.com/v1'
        : 'https://sandbox-api.fedapay.com/v1';
    return callProvider<T>(
      this.logger,
      `FedaPay ${method} ${path}`,
      `${base}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret(this.config, 'FEDAPAY_SECRET_KEY')}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
  }
}

function payinStatus(status?: string): GatewayStatus {
  if (status === 'approved' || status === 'transferred') return 'SUCCEEDED';
  if (status === 'declined' || status === 'canceled' || status === 'refunded') {
    return 'FAILED';
  }
  return 'PROCESSING';
}

// Responses are wrapped as {"v1/transaction": {...}} in the API.
function unwrap(body: Record<string, unknown>, entity: string) {
  return (body[`v1/${entity}`] ?? body) as Record<string, unknown>;
}

function id(payment: StoredPayment) {
  return (payment.providerRef ?? '').split(':')[1];
}
