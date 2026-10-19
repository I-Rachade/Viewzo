import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudflareMailSender } from './cloudflare-mail-sender';
import { ConsoleMailSender } from './console-mail-sender';
import { MAIL_SENDER } from './mail-sender';

// MAIL_PROVIDER=cloudflare sends for real; anything else logs the mail.
@Global()
@Module({
  providers: [
    ConsoleMailSender,
    CloudflareMailSender,
    {
      provide: MAIL_SENDER,
      inject: [ConfigService, ConsoleMailSender, CloudflareMailSender],
      useFactory: (
        config: ConfigService,
        console: ConsoleMailSender,
        cloudflare: CloudflareMailSender,
      ) =>
        config.get('MAIL_PROVIDER') === 'cloudflare' ? cloudflare : console,
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule {}
