import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CreatorsModule } from './creators/creators.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.module';
import { StaffModule } from './staff/staff.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SmsModule,
    MailModule,
    UsersModule,
    AuthModule,
    CreatorsModule,
    CampaignsModule,
    WalletModule,
    StaffModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
