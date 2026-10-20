import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdentityDecision,
  IdentityProvider,
  IdentitySession,
} from './identity-provider';

const DIDIT_URL = 'https://verification.didit.me/v3';
const TIMEOUT = 20_000;

type Json = Record<string, unknown>;

const str = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
// Older answers carry one object, newer ones a list per feature.
const first = (v: unknown): Json | undefined =>
  Array.isArray(v)
    ? (v[0] as Json | undefined)
    : v && typeof v === 'object'
      ? (v as Json)
      : undefined;

/** Maps a Didit decision to ours. Exported for the tests. */
export function mapDiditDecision(body: Json): IdentityDecision {
  const providerStatus = str(body.status) ?? 'Unknown';
  const id = first(body.id_verifications ?? body.id_verification);
  const liveness = first(body.liveness_checks ?? body.liveness);
  const face = first(body.face_matches ?? body.face_match);

  const warnings: string[] = [];
  for (const part of [id, liveness, face]) {
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
    outcome: outcomeOf(providerStatus),
    fullName,
    dateOfBirth: str(id?.date_of_birth),
    documentType: str(id?.document_type),
    documentCountry: str(id?.issuing_state),
    documentNumber: str(id?.document_number) ?? str(id?.personal_number),
    livenessScore: num(liveness?.score),
    faceMatchScore: num(face?.score),
    warnings: [...new Set(warnings)].slice(0, 5),
  };
}

function outcomeOf(status: string): IdentityDecision['outcome'] {
  switch (status.toLowerCase()) {
    case 'approved':
      return 'APPROVED';
    case 'declined':
      return 'DECLINED';
    case 'in review':
      return 'IN_REVIEW';
    case 'abandoned':
    case 'expired':
    case 'kyc expired':
      return 'ABANDONED';
    default:
      // Not Started, In Progress.
      return 'PENDING';
  }
}

// Didit runs the whole check (document read, selfie, liveness, face match)
// on its own pages, in a workflow set up in the Didit console:
// https://docs.didit.me/reference/create-session-verification-sessions
@Injectable()
export class DiditIdentityProvider implements IdentityProvider {
  readonly name = 'didit';
  private readonly logger = new Logger(DiditIdentityProvider.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return Boolean(
      this.config.get('DIDIT_API_KEY') &&
      this.config.get('DIDIT_KYC_WORKFLOW_ID'),
    );
  }

  async createSession(
    checkId: string,
    callbackUrl: string,
  ): Promise<IdentitySession> {
    const body = await this.call('/session/', {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: this.config.getOrThrow<string>('DIDIT_KYC_WORKFLOW_ID'),
        vendor_data: checkId,
        callback: callbackUrl,
      }),
    });
    const sessionId = str(body.session_id);
    const url = str(body.url) ?? str(body.session_url);
    if (!sessionId || !url) {
      this.logger.error('Didit session without id or url');
      throw new ServiceUnavailableException(
        'Service de vérification indisponible',
      );
    }
    return { sessionId, url };
  }

  async decision(sessionId: string) {
    return mapDiditDecision(
      await this.call(`/session/${encodeURIComponent(sessionId)}/decision/`, {
        method: 'GET',
      }),
    );
  }

  private async call(path: string, init: RequestInit): Promise<Json> {
    let res: Response;
    try {
      res = await fetch(`${DIDIT_URL}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.getOrThrow<string>('DIDIT_API_KEY'),
        },
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (e) {
      this.logger.error(`Didit ${path} unreachable`, e as Error);
      throw new ServiceUnavailableException(
        'Service de vérification indisponible',
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
