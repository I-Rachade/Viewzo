import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class WithdrawDto {
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  // Mobile Money number to pay to; the account's number by default.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // Name on the Mobile Money account; must match the ID document.
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  beneficiaryName!: string;

  // Operator code where the provider needs it (Flutterwave countries).
  @IsOptional()
  @IsString()
  @MaxLength(20)
  operator?: string;
}
