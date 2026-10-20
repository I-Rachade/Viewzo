import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { clientIp } from './client-ip';
import {
  IdentifierCodeDto,
  IdentifierDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/identifier.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthUser } from './jwt.strategy';
import { clearSession, refreshTokenFrom, sendSession } from './session-cookie';

// Per address: sending codes costs money, guessing codes and passwords must
// stay slow.
const SEND_CODE = { default: { limit: 5, ttl: 60_000 } };
const CHECK = { default: { limit: 10, ttl: 60_000 } };

function client(req: Request) {
  return { userAgent: req.headers['user-agent'], ip: clientIp(req) };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Sign-up: code to the email or phone, then the password.
  @Post('register/start')
  @Throttle(SEND_CODE)
  @HttpCode(200)
  registerStart(@Body() dto: IdentifierDto) {
    return this.auth.startRegistration(dto.identifier);
  }

  @Post('register/verify')
  @Throttle(CHECK)
  @HttpCode(200)
  registerVerify(@Body() dto: IdentifierCodeDto) {
    return this.auth.verifyRegistration(dto.identifier, dto.code);
  }

  @Post('register/complete')
  @Throttle(CHECK)
  async registerComplete(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RegisterCompleteDto,
  ) {
    return sendSession(
      req,
      res,
      await this.auth.completeRegistration(dto, client(req)),
    );
  }

  @Post('login')
  @Throttle(CHECK)
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    return sendSession(
      req,
      res,
      await this.auth.login(dto.identifier, dto.password, client(req)),
    );
  }

  // Swaps the refresh token for new tokens; the old one stops working.
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RefreshDto,
  ) {
    // A web call may send no body at all.
    const token = refreshTokenFrom(req, dto?.refreshToken);
    if (!token) throw new UnauthorizedException('Reconnecte-toi');
    try {
      return sendSession(req, res, await this.auth.refresh(token, client(req)));
    } catch (e) {
      clearSession(res);
      throw e;
    }
  }

  // Ends this device's session on the server, not only in the browser.
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RefreshDto,
  ) {
    // A web call may send no body at all.
    const token = refreshTokenFrom(req, dto?.refreshToken);
    if (token) await this.auth.logout(token);
    clearSession(res);
  }

  @Post('password/forgot')
  @Throttle(SEND_CODE)
  @HttpCode(200)
  forgot(@Body() dto: IdentifierDto) {
    return this.auth.forgotPassword(dto.identifier);
  }

  @Post('password/reset')
  @Throttle(CHECK)
  @HttpCode(200)
  async reset(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: ResetPasswordDto,
  ) {
    return sendSession(
      req,
      res,
      await this.auth.resetPassword(
        dto.identifier,
        dto.code,
        dto.password,
        client(req),
      ),
    );
  }

  // Adds the other way to sign in (email or phone) to the logged-in account.
  @Post('contact/request')
  @Throttle(SEND_CODE)
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  contactRequest(@Req() req: { user: AuthUser }, @Body() dto: IdentifierDto) {
    return this.auth.requestContact(req.user.userId, dto.identifier);
  }

  @Post('contact/verify')
  @Throttle(CHECK)
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  contactVerify(
    @Req() req: { user: AuthUser },
    @Body() dto: IdentifierCodeDto,
  ) {
    return this.auth.verifyContact(req.user.userId, dto.identifier, dto.code);
  }

  // Code-only login, for accounts without a password.
  @Post('otp/request')
  @Throttle(SEND_CODE)
  @HttpCode(200)
  request(@Body() dto: RequestOtpDto) {
    return this.auth.requestCode(dto.phone);
  }

  @Post('otp/verify')
  @Throttle(CHECK)
  @HttpCode(200)
  async verify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: VerifyOtpDto,
  ) {
    return sendSession(
      req,
      res,
      await this.auth.verifyCode(dto.phone, dto.code, client(req)),
    );
  }
}
