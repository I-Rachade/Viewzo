import { Injectable, Logger } from '@nestjs/common';
import { Mail, MailSender } from './mail-sender';

// Development and test-mode sender: logs the mail instead of sending it.
@Injectable()
export class ConsoleMailSender implements MailSender {
  private readonly logger = new Logger('Mail');

  send(mail: Mail): Promise<void> {
    this.logger.log(`to ${mail.to}: ${mail.subject} | ${mail.text}`);
    return Promise.resolve();
  }
}
