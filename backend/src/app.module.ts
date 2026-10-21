import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CountriesModule } from './countries/countries.module';
import { CreatorsModule } from './creators/creators.module';
import { FilesModule } from './files/files.module';
import { IdentityModule } from './identity/identity.module';
import { LiveModule } from './live/live.module';
import { MailModule } from './mail/mail.module';
import { ModulesModule } from './modules/modules.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PostsModule } from './posts/posts.module';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.module';
import { StaffModule } from './staff/staff.module';
import { AppThrottlerGuard } from './throttle.guard';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Default per address; sign-in routes are stricter (auth.controller.ts).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        // Tests run many sign-ins from one address.
        skipIf: () => config.get('RATE_LIMITS') === 'off',
      }),
    }),
    PrismaModule,
    AuditModule,
    NotificationsModule,
    SmsModule,
    MailModule,
    UsersModule,
    AuthModule,
    CreatorsModule,
    FilesModule,
    IdentityModule,
    CampaignsModule,
    WalletModule,
    PostsModule,
    StaffModule,
    CountriesModule,
    ModulesModule,
    LiveModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
