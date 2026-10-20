import { Inject, Injectable } from '@nestjs/common';
import { MAIL_SENDER } from '../mail/mail-sender';
import type { MailSender } from '../mail/mail-sender';
import { OtpStore } from './otp-store';

// Email codes are generated and checked here, then sent as a mail.
@Injectable()
export class EmailOtpService {
  constructor(
    private readonly store: OtpStore,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  async request(email: string): Promise<void> {
    const code = await this.store.issue(email);
    await this.mail.send({
      to: email,
      subject: `${code} est ton code Viewzo`,
      text:
        `Ton code Viewzo : ${code}\n\n` +
        'Il est valable 10 minutes. Si tu n’as rien demandé, ignore ce message.',
      html:
        `<p>Ton code Viewzo :</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
        '<p>Il est valable 10 minutes. Si tu n’as rien demandé, ignore ce message.</p>',
    });
  }

  verify(email: string, code: string): Promise<void> {
    return this.store.check(email, code);
  }
}
