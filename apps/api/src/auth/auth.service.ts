import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp.service';
import { parsePhone } from './phone';

@Injectable()
export class AuthService {
  constructor(
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async requestCode(rawPhone: string) {
    const { e164 } = this.parse(rawPhone);
    await this.otp.request(e164);
    return { phone: e164 };
  }

  async verifyCode(rawPhone: string, code: string) {
    const { e164, country } = this.parse(rawPhone);
    await this.otp.verify(e164, code);
    const { user, isNew } = await this.users.findOrCreateByPhone(e164, country);
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, isNew, user: this.users.toView(user) };
  }

  private parse(rawPhone: string) {
    return parsePhone(rawPhone, this.config.get('DEFAULT_REGION', 'TG'));
  }
}
