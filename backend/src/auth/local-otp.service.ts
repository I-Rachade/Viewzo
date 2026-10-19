import { Inject, Injectable } from '@nestjs/common';
import { OtpProvider } from './otp-provider';
import { OtpStore } from './otp-store';
import { SMS_SENDER } from '../sms/sms-sender';
import type { SmsSender } from '../sms/sms-sender';

// Generates and checks codes itself and sends them through SmsSender.
// Used in development and tests (OTP_PROVIDER=local).
@Injectable()
export class LocalOtpService implements OtpProvider {
  constructor(
    private readonly store: OtpStore,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async request(phone: string): Promise<void> {
    const code = await this.store.issue(phone);
    await this.sms.send(phone, `Ton code Viewzo : ${code}`);
  }

  verify(phone: string, code: string): Promise<void> {
    return this.store.check(phone, code);
  }
}
