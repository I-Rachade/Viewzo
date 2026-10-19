import { IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Length(6, 20)
  phone!: string;

  @Matches(/^\d{6}$/)
  code!: string;
}
