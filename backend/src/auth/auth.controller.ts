import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
