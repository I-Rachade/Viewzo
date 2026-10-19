import { CreatorSpecialty, CreatorTaskType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SkillsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(CreatorTaskType, { each: true })
  taskTypes!: CreatorTaskType[];

  // Required for creators who make original videos (checked in the service).
  @IsOptional()
  @IsArray()
  @IsEnum(CreatorSpecialty, { each: true })
  specialties?: CreatorSpecialty[];

  @IsBoolean()
  showsFace!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  phoneModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  microphone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lighting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  editingSoftware?: string;

  // 3 to 5 own videos for creators who make originals (checked in the service).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'Ajoute 3 à 5 liens de vidéos' })
  @IsUrl({ require_protocol: true }, { each: true })
  exampleLinks?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  languages!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @Matches(/^[A-Z]{2}$/, { each: true, message: 'Code pays invalide' })
  countries!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  cities?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  themes!: string[];

  @IsInt()
  @Min(1)
  @Max(100)
  tasksPerWeek!: number;
}
