import { IsInt, Max, Min } from 'class-validator';

export class RecordViewsDto {
  // Total validated views of the post so far (not the increase).
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  totalViews!: number;
}
