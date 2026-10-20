import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type GatewayStatus = 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export interface PayinRequest {
  // Our reference, unique per payment.
  reference: string;
  amount: number;
  currency: string;
  // E.164 number of the payer.
  phone: string;
  country: string;
  description: string;
  returnUrl: string;
  notifyUrl: string;
}

export interface PayoutRequest {
  reference: string;
  amount: number;
  currency: string;
  phone: string;
  country: string;
  // Name on the Mobile Money account, must match the ID document.
  beneficiaryName: string;
  // Operator code, needed by providers that cannot infer it from the number.
  operator?: string;
  notifyUrl: string;
}

export interface StoredPayment {
  reference: string;
  providerRef: string | null;
}

export interface PayinResult {
  status: GatewayStatus;
  // What the provider says was paid; compared with what we asked for.
  amount?: number;
  currency?: string;
  reason?: string;
}

export interface PaymentGateway {
  readonly name: string;
  createPayin(
    req: PayinRequest,
  ): Promise<{ checkoutUrl: string; providerRef?: string }>;
  checkPayin(payment: StoredPayment): Promise<PayinResult>;
  createPayout(
    req: PayoutRequest,
  ): Promise<{ status: GatewayStatus; providerRef?: string; reason?: string }>;
  checkPayout(
    payment: StoredPayment,
  ): Promise<{ status: GatewayStatus; reason?: string }>;
  /**
   * Which payment a webhook is about. Webhooks are only a signal: the status is
   * always read back from the provider's API, never trusted from the body.
   */
  webhookRef(
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ): { reference?: string; providerRef?: string } | null;
}

export class GatewayError extends ServiceUnavailableException {}

/** The provider has no keys yet: nothing was sent to it. */
export class GatewayNotConfigured extends GatewayError {}

// A provider that does not answer within this time is treated as unknown.
const PROVIDER_TIMEOUT_MS = 20_000;

/** JSON call to a provider; any network or HTTP error becomes a 503. */
export async function callProvider<T>(
  logger: Logger,
  label: string,
  url: string,
  init: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (e) {
    logger.error(`${label} unreachable`, e);
    throw new GatewayError('Service de paiement indisponible');
  }
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    // Only the status: provider bodies can hold names and phone numbers.
    logger.error(`${label} failed with ${res.status}`);
    throw new GatewayError('Le service de paiement a refusé la demande');
  }
  return body as T;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

/** A provider secret; a missing one means the provider isn't set up yet. */
export function secret(config: ConfigService, key: string) {
  const value = config.get<string>(key);
  if (!value) {
    throw new GatewayNotConfigured(
      'Ce moyen de paiement n’est pas encore disponible',
    );
  }
  return value;
}
