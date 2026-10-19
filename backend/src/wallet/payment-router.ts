import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CinetpayGateway } from './gateways/cinetpay.gateway';
import { FedapayGateway } from './gateways/fedapay.gateway';
import { FlutterwaveGateway } from './gateways/flutterwave.gateway';
import { GatewayError, PaymentGateway } from './gateways/gateway';
import { LocalGateway } from './gateways/local.gateway';

// FedaPay for Togo and Benin, CinetPay for the other French-speaking
// countries, Flutterwave everywhere else. Overridden by PAYMENT_ROUTES.
export const DEFAULT_ROUTES =
  'TG:fedapay,BJ:fedapay,CI:cinetpay,SN:cinetpay,CM:cinetpay,BF:cinetpay,' +
  'ML:cinetpay,NE:cinetpay,GN:cinetpay,CD:cinetpay,*:flutterwave';

@Injectable()
export class PaymentRouter {
  private readonly gateways: Map<string, PaymentGateway>;
  private readonly routes: Map<string, string>;

  constructor(
    private readonly config: ConfigService,
    local: LocalGateway,
    fedapay: FedapayGateway,
    cinetpay: CinetpayGateway,
    flutterwave: FlutterwaveGateway,
  ) {
    this.gateways = new Map(
      [local, fedapay, cinetpay, flutterwave].map((g) => [g.name, g]),
    );
    this.routes = new Map(
      this.config
        .get<string>('PAYMENT_ROUTES', DEFAULT_ROUTES)
        .split(',')
        .map((entry) => entry.split(':').map((s) => s.trim()))
        .filter(([country, name]) => country && name)
        .map(([country, name]) => [country.toUpperCase(), name.toLowerCase()]),
    );
  }

  /** Provider name used for users of a country. */
  providerFor(country: string) {
    if (this.config.get('PAYMENT_MODE') === 'local') return 'local';
    return this.routes.get(country) ?? this.routes.get('*') ?? 'flutterwave';
  }

  forCountry(country: string) {
    return this.byName(this.providerFor(country));
  }

  byName(name: string) {
    const gateway = this.gateways.get(name);
    if (
      !gateway ||
      (name === 'local' && this.config.get('PAYMENT_MODE') !== 'local')
    ) {
      throw new GatewayError('Ce moyen de paiement n’est pas disponible');
    }
    return gateway;
  }
}
