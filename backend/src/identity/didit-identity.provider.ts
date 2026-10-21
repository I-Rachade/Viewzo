import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdentityDecision,
  IdentityImage,
  IdentityImages,
  IdentityProvider,
} from './identity-provider';

const DIDIT_URL = 'https://verification.didit.me/v3';
const TIMEOUT = 30_000;

type Json = Record<string, unknown>;

const str = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
// An answer may carry one object or a list of them.
const first = (v: unknown): Json | undefined =>
  Array.isArray(v)
    ? (v[0] as Json | undefined)
    : v && typeof v === 'object'
      ? (v as Json)
      : undefined;

/**
 * Combines the three standalone answers (document, liveness, face match)
 * into one decision: approved only when all three are, declined as soon as
 * one is. Exported for the tests.
 */
export function mapDiditDecision(answers: {
  id?: Json;
  liveness?: Json;
  face?: Json;
}): IdentityDecision {
  const id = first(answers.id?.id_verification ?? answers.id);
  const liveness = first(
    answers.liveness?.liveness ??
      answers.liveness?.passive_liveness ??
      answers.liveness,
  );
  const face = first(answers.face?.face_match ?? answers.face);
  const parts = [id, liveness, face];

  const statuses = parts.map((p) => str(p?.status)?.toLowerCase());
  const providerStatus = statuses.includes('declined')
    ? 'Declined'
    : statuses.every((s) => s === 'approved')
      ? 'Approved'
      : 'In Review';

  const warnings: string[] = [];
  for (const part of parts) {
    const list = part?.warnings;
    if (!Array.isArray(list)) continue;
    for (const w of list as Json[]) {
      const text = str(w.short_description) ?? str(w.risk);
      if (text) warnings.push(text);
    }
  }

  const fullName =
    str(id?.full_name) ??
    ([str(id?.first_name), str(id?.last_name)].filter(Boolean).join(' ') ||
      undefined);

  return {
    providerStatus,
    outcome:
      providerStatus === 'Approved'
        ? 'APPROVED'
        : providerStatus === 'Declined'
          ? 'DECLINED'
          : 'IN_REVIEW',
    fullName,
    firstName: str(id?.first_name),
    dateOfBirth: str(id?.date_of_birth),
    documentType: str(id?.document_type),
    documentCountry: str(id?.issuing_state),
    documentNumber: str(id?.document_number) ?? str(id?.personal_number),
    livenessScore: num(liveness?.score),
    faceMatchScore: num(face?.score),
    warnings: [...new Set(warnings)].slice(0, 5),
  };
}

// Like the phone codes at signup, only the API key is needed: the photos go
// to Didit's standalone APIs and the answer comes back at once.
// https://docs.didit.me/standalone-apis/id-verification
// https://docs.didit.me/standalone-apis/passive-liveness
// https://docs.didit.me/standalone-apis/face-match
@Injectable()
export class DiditIdentityProvider implements IdentityProvider {
  readonly name = 'didit';
  private readonly logger = new Logger(DiditIdentityProvider.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return Boolean(this.config.get('DIDIT_API_KEY'));
  }

  async verify(checkId: string, images: IdentityImages) {
    const form = (
      fields: Record<string, IdentityImage | string | undefined>,
    ) => {
      const data = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        if (typeof value === 'string') {
          data.append(key, value);
        } else {
          const blob = new Blob([new Uint8Array(value.buffer)], {
            type: value.mimeType,
          });
          data.append(key, blob, `${key}.${ext(value)}`);
        }
      }
      return data;
    };
    const [id, liveness, face] = await Promise.all([
      this.post(
        '/id-verification/',
        form({
          front_image: images.front,
          back_image: images.back,
          vendor_data: checkId,
        }),
      ),
      this.post(
        '/passive-liveness/',
        form({ user_image: images.selfie, vendor_data: checkId }),
      ),
      this.post(
        '/face-match/',
        form({
          user_image: images.selfie,
          ref_image: images.front,
          vendor_data: checkId,
        }),
      ),
    ]);
    return mapDiditDecision({ id, liveness, face });
  }

  private async post(path: string, body: FormData): Promise<Json> {
    let res: Response;
    try {
      res = await fetch(`${DIDIT_URL}${path}`, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.getOrThrow<string>('DIDIT_API_KEY'),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (e) {
      this.logger.error(`Didit ${path} unreachable`, e as Error);
      throw new ServiceUnavailableException(
        'Service de vérification indisponible',
      );
    }
    if (res.status === 429) {
      throw new HttpException(
        'Trop de vérifications en même temps, réessaie dans une minute',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (res.status === 400) {
      this.logger.warn(`Didit ${path} refused the photos`);
      throw new BadRequestException(
        'Photo illisible : reprends-la bien éclairée, la pièce en entier',
      );
    }
    if (!res.ok) {
      this.logger.error(`Didit ${path} answered ${res.status}`);
      throw new ServiceUnavailableException(
        'Service de vérification indisponible',
      );
    }
    return (await res.json()) as Json;
  }
}

const ext = (image: IdentityImage) =>
  image.mimeType === 'image/png'
    ? 'png'
    : image.mimeType === 'image/webp'
      ? 'webp'
      : 'jpg';
