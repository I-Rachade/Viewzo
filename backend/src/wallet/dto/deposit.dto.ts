import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class DepositDto {
  @IsInt()
  @Min(500)
  @Max(10_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}
