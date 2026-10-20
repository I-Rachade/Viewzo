import { IsBoolean, IsString, Matches } from 'class-validator';

export class AddCountryDto {
  // ISO 3166-1 alpha-2, any case.
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  code!: string;
}

export class SetCountryDto {
  @IsBoolean()
  enabled!: boolean;
}
