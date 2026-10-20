import { StaffRole } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class MemberRightsDto {
  @IsEnum(StaffRole)
  staffRole!: StaffRole;

  // ISO country codes; empty or missing: every country.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  countries?: string[];
}

export class AddMemberDto extends MemberRightsDto {
  @IsString()
  @MaxLength(30)
  phone!: string;
}
