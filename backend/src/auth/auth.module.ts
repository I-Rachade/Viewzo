import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { DiditOtpService } from './didit-otp.service';
import { LocalOtpService } from './local-otp.service';
import { OTP_PROVIDER } from './otp-provider';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LocalOtpService,
    DiditOtpService,
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
})
export class AuthModule {}
