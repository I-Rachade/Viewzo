import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  firstName!: string;
}
