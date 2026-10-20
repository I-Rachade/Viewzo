import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

// Sent as multipart/form-data next to the "file" image.
export class AddScreenshotDto {
  // Views shown on the screenshot.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  declaredViews!: number;

  // When the screenshot was taken, from the phone's file date.
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}
