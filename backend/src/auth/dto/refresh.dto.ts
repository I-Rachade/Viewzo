import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  // The app sends it here; the web relies on its cookie.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}
