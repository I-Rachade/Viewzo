import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mail, MailSender } from './mail-sender';

// Cloudflare Email Sending over its REST API:
// https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
@Injectable()
export class CloudflareMailSender implements MailSender {
  private readonly logger = new Logger(CloudflareMailSender.name);

  constructor(private readonly config: ConfigService) {}

  async send(mail: Mail): Promise<void> {
    const account = this.config.getOrThrow<string>('CLOUDFLARE_ACCOUNT_ID');
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow<string>('CLOUDFLARE_EMAIL_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.get<string>('MAIL_FROM') || 'noreply@viewzo.app',
          ...mail,
        }),
      });
    } catch (e) {
      this.logger.error('Cloudflare unreachable', e);
      throw new ServiceUnavailableException("Envoi de l'e-mail impossible");
    }
    if (!res.ok) {
      this.logger.error(`Cloudflare ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException("Envoi de l'e-mail impossible");
    }
  }
}
