import { Global, Module } from '@nestjs/common';
import { ConsoleSmsSender } from './console-sms-sender';
import { SMS_SENDER } from './sms-sender';

@Global()
@Module({
  providers: [{ provide: SMS_SENDER, useClass: ConsoleSmsSender }],
  exports: [SMS_SENDER],
})
export class SmsModule {}
