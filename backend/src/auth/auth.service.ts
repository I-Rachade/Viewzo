import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ProfileType, User, UserProfile } from '@prisma/client';
import { isSupportedCountry } from 'libphonenumber-js';
import { PrismaService } from '../prisma/prisma.service';
import { CountriesService } from '../countries/countries.service';
import {
  ALREADY_REGISTERED,
  SIGNUP_CLOSED,
  UsersService,
} from '../users/users.service';
import { EmailOtpService } from './email-otp.service';
import { Identifier, parseIdentifier } from './identifier';
import { OTP_PROVIDER } from './otp-provider';
import type { OtpProvider } from './otp-provider';
import { hashPassword, verifyPassword } from './password';
import { parsePhone } from './phone';
import { ClientInfo, SessionsService } from './sessions.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const WRONG_CREDENTIALS = 'Identifiants incorrects';

interface RegisterTicket {
  purpose: 'register';
  kind: Identifier['kind'];
  value: string;
}

@Injectable()
export class AuthService {
  // Compared against when the account does not exist, so a wrong identifier
  // takes as long as a wrong password.
  private readonly decoyHash = hashPassword('decoy-password-1');

  constructor(
    @Inject(OTP_PROVIDER) private readonly otp: OtpProvider,
    private readonly emailOtp: EmailOtpService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: SessionsService,
    private readonly countries: CountriesService,
  ) {}

  // Code-only login kept for accounts from before passwords. An account with
  // a password signs in with it: a code alone (a stolen SMS, a swapped SIM)
  // is not enough.
  async requestCode(rawPhone: string) {
    const { e164 } = this.parsePhone(rawPhone);
    await this.otp.request(e164);
    return { phone: e164 };
  }

  async verifyCode(rawPhone: string, code: string, client: ClientInfo) {
    const { e164, country } = this.parsePhone(rawPhone);
    await this.otp.verify(e164, code);
    const { user, isNew } = await this.users.findOrCreateByPhone(e164, country);
    if (user.passwordHash) {
      throw new ForbiddenException({
        code: 'PASSWORD_LOGIN_REQUIRED',
        message: 'Connecte-toi avec ton mot de passe',
      });
    }
    return { ...(await this.session(user, client)), isNew };
  }

  /** New tokens for a device that is still signed in. */
  async refresh(refreshToken: string, client: ClientInfo) {
    const { user, session } = await this.sessions.refresh(refreshToken, client);
    const full = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { profiles: true },
    });
    return { ...session, user: this.users.toView(full) };
  }

  logout(sessionOrToken: string) {
    return this.sessions.revoke(sessionOrToken);
  }

  async startRegistration(raw: string) {
    const id = this.parse(raw);
    if (await this.users.findByContact(id)) {
      throw new ConflictException(ALREADY_REGISTERED);
    }
    // Before any code is sent; e-mail sign-ups are checked at the last step.
    if (id.kind === 'phone') {
      await this.countries.assertAllowed(
        this.parsePhone(id.value).country,
        SIGNUP_CLOSED,
      );
    }
    await this.sendCode(id);
    return { sentTo: id.value };
  }

  // A valid code proves the email or phone; the ticket carries that proof to
  // the password step.
  async verifyRegistration(raw: string, code: string) {
    const id = this.parse(raw);
    await this.checkCode(id, code);
    const ticket: RegisterTicket = {
      purpose: 'register',
      kind: id.kind,
      value: id.value,
    };
    return { ticket: await this.jwt.signAsync(ticket, { expiresIn: '15m' }) };
  }

  async completeRegistration(
    input: {
      ticket: string;
      password: string;
      role: ProfileType;
      country?: string;
    },
    client: ClientInfo,
  ) {
    const ticket = await this.readTicket(input.ticket);
    const country =
      ticket.kind === 'phone'
        ? this.parsePhone(ticket.value).country
        : input.country;
    if (!country || !isSupportedCountry(country)) {
      throw new BadRequestException('Choisis ton pays');
    }
    const user = await this.users.register({
      contact: { kind: ticket.kind, value: ticket.value },
      country,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    });
    return { ...(await this.session(user, client)), isNew: true };
  }

  async login(raw: string, password: string, client: ClientInfo) {
    const user = await this.users.findByContact(this.parse(raw));
    if (!user) {
      await verifyPassword(password, await this.decoyHash);
      throw new UnauthorizedException(WRONG_CREDENTIALS);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60_000,
      );
      throw new HttpException(
        `Trop de tentatives, réessaie dans ${minutes} min ou réinitialise ton mot de passe`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!user.passwordHash) {
      throw new ForbiddenException({
        code: 'PASSWORD_NOT_SET',
        message: 'Définis ton mot de passe pour te connecter',
      });
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      // Counted in the database, so parallel attempts all count.
      const { failedLogins } = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 } },
        select: { failedLogins: true },
      });
      if (failedLogins >= MAX_FAILED_LOGINS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLogins: 0,
            lockedUntil: new Date(Date.now() + LOCK_MS),
          },
        });
      }
      throw new UnauthorizedException(WRONG_CREDENTIALS);
    }

    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }
    return this.session(user, client);
  }

  // Answers the same whether or not the account exists.
  async forgotPassword(raw: string) {
    const id = this.parse(raw);
    if (await this.users.findByContact(id)) await this.sendCode(id);
    return { sentTo: id.value };
  }

  async resetPassword(
    raw: string,
    code: string,
    password: string,
    client: ClientInfo,
  ) {
    const id = this.parse(raw);
    const user = await this.users.findByContact(id);
    if (!user) {
      throw new UnauthorizedException('Code expiré, demande un nouveau code');
    }
    await this.checkCode(id, code);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        // Logs out every other session.
        tokenVersion: { increment: 1 },
        failedLogins: 0,
        lockedUntil: null,
      },
      include: { profiles: true },
    });
    await this.sessions.revokeAll(user.id);
    return this.session(updated, client);
  }

  async requestContact(userId: string, raw: string) {
    const id = this.parse(raw);
    const owner = await this.users.findByContact(id);
    if (owner) {
      throw new ConflictException(
        owner.id === userId
          ? 'Cet identifiant est déjà sur ton compte'
          : 'Cet identifiant est déjà utilisé par un autre compte',
      );
    }
    await this.sendCode(id);
    return { sentTo: id.value };
  }

  async verifyContact(userId: string, raw: string, code: string) {
    const id = this.parse(raw);
    await this.checkCode(id, code);
    return this.users.toView(await this.users.setContact(userId, id));
  }

  private async session(
    user: User & { profiles: UserProfile[] },
    client: ClientInfo,
  ) {
    const issued = await this.sessions.issue(user, client);
    return { ...issued, user: this.users.toView(user) };
  }

  private async readTicket(token: string): Promise<RegisterTicket> {
    try {
      const ticket = await this.jwt.verifyAsync<RegisterTicket>(token);
      if (ticket.purpose === 'register') return ticket;
    } catch {
      // Expired or forged: same answer below.
    }
    throw new UnauthorizedException(
      'Vérification expirée, recommence l’inscription',
    );
  }

  private sendCode(id: Identifier) {
    return id.kind === 'email'
      ? this.emailOtp.request(id.value)
      : this.otp.request(id.value);
  }

  private checkCode(id: Identifier, code: string) {
    return id.kind === 'email'
      ? this.emailOtp.verify(id.value, code)
      : this.otp.verify(id.value, code);
  }

  private parse(raw: string) {
    return parseIdentifier(raw, this.region());
  }

  private parsePhone(raw: string) {
    return parsePhone(raw, this.region());
  }

  private region() {
    return this.config.get<string>('DEFAULT_REGION', 'TG');
  }
}
