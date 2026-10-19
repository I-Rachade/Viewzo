import { Injectable, Logger } from '@nestjs/common';
import { SmsSender } from './sms-sender';

// Development sender: logs the message instead of sending it.
// Replace with a real provider (Bird, Twilio, ...) behind the same interface.
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('SMS');

  send(phone: string, message: string): Promise<void> {
    this.logger.log(`to ${phone}: ${message}`);
    return Promise.resolve();
  }
}
