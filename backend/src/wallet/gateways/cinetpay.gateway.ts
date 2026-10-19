import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { phoneParts, splitName } from './phone-parts';

const CHECKOUT_URL = 'https://api-checkout.cinetpay.com/v2';
const TRANSFER_URL = 'https://client.cinetpay.com/v1';

// Payments: https://docs.cinetpay.com/api/1.0-en/checkout/initialisation
// Transfers: https://docs.cinetpay.com/api/1.0-en/transfert/utilisation
// Transfers are confirmed by email unless the server IP is whitelisted.
@Injectable()
export class CinetpayGateway implements PaymentGateway {
  readonly name = 'cinetpay';
  private readonly logger = new Logger(CinetpayGateway.name);

  constructor(private readonly config: ConfigService) {}

  async createPayin(req: PayinRequest) {
    assertMultipleOf5(req.amount);
    const body = await this.checkout<{ data?: { payment_url?: string } }>(
      '/payment',
      {
        transaction_id: req.reference,
        amount: req.amount,
        currency: req.currency,
        // Special characters (#, /, $, _, &) are refused.
        description: req.description.replace(/[#/$_&]/g, ' '),
        notify_url: req.notifyUrl,
        return_url: req.returnUrl,
        channels: 'MOBILE_MONEY',
        lang: 'fr',
        customer_phone_number: req.phone,
      },
    );
    return { checkoutUrl: body.data?.payment_url ?? '' };
  }

  async checkPayin(payment: StoredPayment) {
    let body: { code?: string; data?: Record<string, unknown> };
    try {
      body = await this.checkout('/payment/check', {
        transaction_id: payment.reference,
      });
    } catch (e) {
      // Pending payments come back as errors; ask again later.
      if (e instanceof GatewayError) return { status: 'PROCESSING' as const };
      throw e;
    }
    const status = str(body.data?.status);
    const result: GatewayStatus =
      status === 'ACCEPTED'
        ? 'SUCCEEDED'
        : status === 'REFUSED' || body.code === '627'
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
    assertMultipleOf5(req.amount);
    const token = await this.login();
    const { national, countryCallingCode } = phoneParts(req.phone);
    const { firstname, lastname } = splitName(req.beneficiaryName);
    // Adding a contact that already exists is harmless.
    await this.transfer('POST', '/transfer/contact', token, [
      {
        prefix: countryCallingCode,
        phone: national,
        name: lastname,
        surname: firstname,
        email: this.config.get<string>(
          'CINETPAY_CONTACT_EMAIL',
          'paiements@viewzo.app',
        ),
      },
    ]).catch(() => undefined);
    await this.transfer('POST', '/transfer/money/send/contact', token, [
      {
        prefix: countryCallingCode,
        phone: national,
        amount: req.amount,
        notify_url: req.notifyUrl,
        client_transaction_id: req.reference,
      },
    ]);
    return { status: 'PROCESSING' as const, providerRef: req.reference };
  }

  async checkPayout(payment: StoredPayment) {
    const token = await this.login();
    const body = await this.transfer<{ data?: unknown }>(
      'GET',
      `/transfer/check/money`,
      token,
      undefined,
      { client_transaction_id: payment.reference },
    );
    const entry = (Array.isArray(body.data) ? body.data[0] : body.data) as
      Record<string, unknown> | undefined;
    const status = str(entry?.treatment_status);
    const result: GatewayStatus =
      status === 'VAL'
        ? 'SUCCEEDED'
        : status === 'REJ'
          ? 'FAILED'
          : 'PROCESSING';
    return { status: result, reason: str(entry?.comment) ?? status };
  }

  webhookRef(body: Record<string, unknown>) {
    const reference = str(body.cpm_trans_id) ?? str(body.client_transaction_id);
    return reference ? { reference } : null;
  }

  private checkout<T>(path: string, payload: object) {
    return callProvider<T>(
      this.logger,
      `CinetPay ${path}`,
      `${CHECKOUT_URL}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apikey: secret(this.config, 'CINETPAY_API_KEY'),
          site_id: secret(this.config, 'CINETPAY_SITE_ID'),
          ...payload,
        }),
      },
    );
  }

  private async login() {
    const body = await callProvider<{ data?: { token?: string } }>(
      this.logger,
      'CinetPay login',
      `${TRANSFER_URL}/auth/login?lang=fr`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          apikey: secret(this.config, 'CINETPAY_API_KEY'),
          password: secret(this.config, 'CINETPAY_TRANSFER_PASSWORD'),
        }),
      },
    );
    if (!body.data?.token) {
      throw new GatewayError('Connexion au service de transfert impossible');
    }
    return body.data.token;
  }

  private transfer<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    token: string,
    data?: object[],
    query: Record<string, string> = {},
  ) {
    const params = new URLSearchParams({ token, lang: 'fr', ...query });
    return callProvider<T>(
      this.logger,
      `CinetPay ${path}`,
      `${TRANSFER_URL}${path}?${params}`,
      {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: data
          ? new URLSearchParams({ data: JSON.stringify(data) })
          : undefined,
      },
    );
  }
}

function assertMultipleOf5(amount: number) {
  if (amount % 5 !== 0) {
    throw new BadRequestException('Le montant doit être un multiple de 5 FCFA');
  }
}
