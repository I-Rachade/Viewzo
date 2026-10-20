import { IsBoolean } from 'class-validator';

export class SetModuleDto {
  @IsBoolean()
  enabled!: boolean;
}
