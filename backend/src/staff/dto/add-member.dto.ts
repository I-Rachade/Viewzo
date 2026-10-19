import { IsString, MaxLength } from 'class-validator';

export class AddMemberDto {
  @IsString()
  @MaxLength(30)
  phone!: string;
}
