import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { DiditOtpService } from './didit-otp.service';
import { EmailOtpService } from './email-otp.service';
import { LocalOtpService } from './local-otp.service';
import { OTP_PROVIDER } from './otp-provider';
import { OtpStore } from './otp-store';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // Sessions set their own lifetimes (see SessionsService).
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    JwtStrategy,
    OtpStore,
    LocalOtpService,
    DiditOtpService,
    EmailOtpService,
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService, LocalOtpService, DiditOtpService],
      useFactory: (
        config: ConfigService,
        local: LocalOtpService,
        didit: DiditOtpService,
      ) => (config.get('OTP_PROVIDER') === 'didit' ? didit : local),
    },
  ],
  exports: [SessionsService],
})
export class AuthModule {}
