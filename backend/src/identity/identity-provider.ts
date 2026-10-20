/** What a provider says about one identity verification. */
export interface IdentityDecision {
  // The provider's own status, e.g. Approved, In Review, Declined.
  providerStatus: string;
  outcome: 'PENDING' | 'APPROVED' | 'IN_REVIEW' | 'DECLINED' | 'ABANDONED';
  fullName?: string;
  dateOfBirth?: string;
  documentType?: string;
  documentCountry?: string;
  documentNumber?: string;
  livenessScore?: number;
  faceMatchScore?: number;
  // Short reasons the provider gives for a decline or a manual review.
  warnings: string[];
}

export interface IdentitySession {
  sessionId: string;
  url: string;
}

export interface IdentityProvider {
  readonly name: string;
  /** False when the provider is not set up: verification is closed. */
  readonly enabled: boolean;
  createSession(checkId: string, callbackUrl: string): Promise<IdentitySession>;
  decision(sessionId: string): Promise<IdentityDecision>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
