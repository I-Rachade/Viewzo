import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpProvider } from './otp-provider';

const DIDIT_URL = 'https://verification.didit.me/v3/phone';

// Didit generates, sends and checks the code itself:
// https://docs.didit.me/standalone-apis/phone-send
// https://docs.didit.me/standalone-apis/phone-check
@Injectable()
export class DiditOtpService implements OtpProvider {
  private readonly logger = new Logger(DiditOtpService.name);

  constructor(private readonly config: ConfigService) {}

  async request(phone: string): Promise<void> {
    const body = await this.post('/send/', {
      phone_number: phone,
      options: { code_size: 6, locale: 'fr', preferred_channel: 'sms' },
    });
    if (body.status === 'Blocked') {
      throw new ForbiddenException('Envoi du code refusé pour ce numéro');
    }
  }

  async verify(phone: string, code: string): Promise<void> {
    const body = await this.post('/check/', { phone_number: phone, code });
    switch (body.status) {
      case 'Approved':
        return;
      case 'Failed':
        throw new UnauthorizedException('Code incorrect');
      case 'Declined':
        throw new UnauthorizedException(
          'Vérification refusée, demande un nouveau code',
        );
      default:
        throw new UnauthorizedException('Code expiré, demande un nouveau code');
    }
  }

  private async post(
    path: string,
    payload: object,
  ): Promise<{ status?: string }> {
    let res: Response;
    try {
      res = await fetch(`${DIDIT_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.getOrThrow<string>('DIDIT_API_KEY'),
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      this.logger.error(`Didit ${path} unreachable`, e);
      throw new ServiceUnavailableException(
        'Service de vérification indisponible',
      );
    }
    if (res.status === 429) {
      throw new HttpException(
        'Trop de tentatives, réessaie plus tard',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (res.status === 400) {
      throw new HttpException(
        'Numéro de téléphone refusé',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!res.ok) {
      this.logger.error(`Didit ${path} ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException(
        'Service de vérification indisponible',
      );
    }
    return (await res.json()) as { status?: string };
  }
}
