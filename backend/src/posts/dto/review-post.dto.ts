import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const POST_DECISIONS = [
  'VALIDATE',
  'NEEDS_FIX',
  'REJECT',
  'SUSPEND_ACCOUNT',
  // The 30-day check: still online, or deleted.
  'STILL_ONLINE',
  'REMOVED',
] as const;
export type PostDecision = (typeof POST_DECISIONS)[number];

export class ReviewPostDto {
  @IsIn(POST_DECISIONS)
  decision!: PostDecision;

  // Total validated views, required to validate.
  @ValidateIf((o: ReviewPostDto) => o.decision === 'VALIDATE')
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  views?: number;

  // Shown to the creator; required for everything but a validation.
  @ValidateIf(
    (o: ReviewPostDto) =>
      o.decision !== 'VALIDATE' && o.decision !== 'STILL_ONLINE',
  )
  @IsString()
  @MaxLength(500)
  reason?: string;
}
