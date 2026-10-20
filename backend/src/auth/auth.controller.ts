import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  IdentifierCodeDto,
  IdentifierDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/identifier.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthUser } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Sign-up: code to the email or phone, then the password.
  @Post('register/start')
  @HttpCode(200)
  registerStart(@Body() dto: IdentifierDto) {
    return this.auth.startRegistration(dto.identifier);
  }

  @Post('register/verify')
  @HttpCode(200)
  registerVerify(@Body() dto: IdentifierCodeDto) {
    return this.auth.verifyRegistration(dto.identifier, dto.code);
  }

  @Post('register/complete')
  registerComplete(@Body() dto: RegisterCompleteDto) {
    return this.auth.completeRegistration(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.identifier, dto.password);
  }

  @Post('password/forgot')
  @HttpCode(200)
  forgot(@Body() dto: IdentifierDto) {
    return this.auth.forgotPassword(dto.identifier);
  }

  @Post('password/reset')
  @HttpCode(200)
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.identifier, dto.code, dto.password);
  }

  // Adds the other way to sign in (email or phone) to the logged-in account.
  @Post('contact/request')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  contactRequest(@Req() req: { user: AuthUser }, @Body() dto: IdentifierDto) {
    return this.auth.requestContact(req.user.userId, dto.identifier);
  }

  @Post('contact/verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  contactVerify(
    @Req() req: { user: AuthUser },
    @Body() dto: IdentifierCodeDto,
  ) {
    return this.auth.verifyContact(req.user.userId, dto.identifier, dto.code);
  }

  // Code-only login, kept until every app has the password screens.
  @Post('otp/request')
  @HttpCode(200)
  request(@Body() dto: RequestOtpDto) {
    return this.auth.requestCode(dto.phone);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyCode(dto.phone, dto.code);
  }
}
