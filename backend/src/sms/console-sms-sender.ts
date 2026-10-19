import { Injectable, Logger } from '@nestjs/common';
import { SmsSender } from './sms-sender';

// Development sender used by the local OTP provider: logs the message.
// In production, OTP_PROVIDER=didit sends and checks codes through Didit.
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  send(phone: string, message: string): Promise<void> {
    this.logger.log(`to ${phone}: ${message}`);
    return Promise.resolve();
  }
}
