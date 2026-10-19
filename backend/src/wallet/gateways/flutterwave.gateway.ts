import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import {
  callProvider,
  GatewayError,
  GatewayStatus,
  PayinRequest,
  PaymentGateway,
  PayoutRequest,
  StoredPayment,
  secret,
  str,
} from './gateway';
import { phoneParts } from './phone-parts';

const BASE_URL = 'https://api.flutterwave.com/v3';

// Mobile Money operators Flutterwave pays out to, per country:
// https://developer.flutterwave.com/v3.0/docs/mobile-money
export const FLUTTERWAVE_OPERATORS: Record<string, string[]> = {
  CI: ['MOOV', 'MTN', 'ORANGE', 'WAVE'],
  SN: ['ORANGEMONEY', 'WAVE'],
  CM: ['MTN', 'ORANGEMONEY'],
  GH: ['AIRTELTIGO', 'MTN', 'VODAFONE'],
  KE: ['MPS'],
  RW: ['MPS', 'MTN'],
  UG: ['AIRTEL', 'MTN'],
  ZM: ['MPS'],
};

@Injectable()
export class FlutterwaveGateway implements PaymentGateway {
  readonly name = 'flutterwave';
  private readonly logger = new Logger(FlutterwaveGateway.name);

  constructor(private readonly config: ConfigService) {}

  async createPayin(req: PayinRequest) {
    const { digits } = phoneParts(req.phone);
    const body = await this.call<{ data?: { link?: string } }>(
      'POST',
      '/payments',
      {
        tx_ref: req.reference,
        amount: req.amount,
        currency: req.currency,
        redirect_url: req.returnUrl,
        // Flutterwave requires an email; users sign up with their phone only.
        customer: {
          email: `${digits}@clients.viewzo.app`,
          phonenumber: req.phone,
        },
        customizations: { title: 'Viewzo', description: req.description },
      },
    );
    return { checkoutUrl: body.data?.link ?? '' };
  }

  async checkPayin(payment: StoredPayment) {
    let body: { data?: Record<string, unknown> };
    try {
      body = await this.call(
        'GET',
        `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(payment.reference)}`,
      );
    } catch (e) {
      // Not found until the customer has paid.
      if (e instanceof GatewayError) return { status: 'PROCESSING' as const };
      throw e;
    }
    const status = str(body.data?.status);
    const result: GatewayStatus =
      status === 'successful'
        ? 'SUCCEEDED'
        : status === 'failed'
          ? 'FAILED'
          : 'PROCESSING';
    return {
      status: result,
      amount: Number(body.data?.amount),
      currency: str(body.data?.currency),
      reason: status,
    };
  }

  async createPayout(req: PayoutRequest) {
    const operators = FLUTTERWAVE_OPERATORS[req.country] ?? [];
    if (!req.operator || !operators.includes(req.operator)) {
      throw new BadRequestException(
        operators.length
          ? `Choisis ton opérateur : ${operators.join(', ')}`
          : 'Retrait Mobile Money indisponible dans ce pays',
      );
    }
    const body = await this.call<{ data?: Record<string, unknown> }>(
      'POST',
      '/transfers',
      {
        account_bank: req.operator,
        account_number: phoneParts(req.phone).digits,
        amount: req.amount,
        currency: req.currency,
        beneficiary_name: req.beneficiaryName,
        reference: req.reference,
        callback_url: req.notifyUrl,
        narration: 'Retrait Viewzo',
      },
    );
    return { status: 'PROCESSING' as const, providerRef: str(body.data?.id) };
  }

  async checkPayout(payment: StoredPayment) {
    const body = await this.call<{ data?: Record<string, unknown> }>(
      'GET',
      `/transfers/${payment.providerRef}`,
    );
    const status = str(body.data?.status);
    const result: GatewayStatus =
      status === 'SUCCESSFUL'
        ? 'SUCCEEDED'
        : status === 'FAILED'
          ? 'FAILED'
          : 'PROCESSING';
    return {
      status: result,
      reason: str(body.data?.complete_message) ?? status,
    };
  }

  webhookRef(
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const expected = this.config.get<string>('FLUTTERWAVE_WEBHOOK_HASH') ?? '';
    const given = String(headers['verif-hash'] ?? '');
    if (
      !expected ||
      given.length !== expected.length ||
      !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    ) {
      throw new UnauthorizedException();
    }
    const data = (body.data ?? {}) as Record<string, unknown>;
    const reference = str(data.tx_ref) ?? str(data.reference);
    return reference ? { reference } : null;
  }

  private call<T>(method: string, path: string, body?: object) {
    return callProvider<T>(
      this.logger,
      `Flutterwave ${method} ${path}`,
      `${BASE_URL}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret(this.config, 'FLUTTERWAVE_SECRET_KEY')}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
  }
}
