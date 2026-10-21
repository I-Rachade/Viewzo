/** What a provider says about one identity verification. */
export interface IdentityDecision {
  // The provider's own status, e.g. Approved, In Review, Declined.
  providerStatus: string;
  outcome: 'APPROVED' | 'IN_REVIEW' | 'DECLINED';
  fullName?: string;
  firstName?: string;
  dateOfBirth?: string;
  documentType?: string;
  documentCountry?: string;
  documentNumber?: string;
  livenessScore?: number;
  faceMatchScore?: number;
  // Short reasons the provider gives for a decline or a manual review.
  warnings: string[];
}

/** One photo sent by the person, kept in memory only. */
export interface IdentityImage {
  buffer: Buffer;
  mimeType: string;
}

/** The photos of one verification: the document and a selfie. */
export interface IdentityImages {
  front: IdentityImage;
  back?: IdentityImage;
  selfie: IdentityImage;
}

export interface IdentityProvider {
  readonly name: string;
  /** False when the provider is not set up: verification is closed. */
  readonly enabled: boolean;
  /** Reads the document, checks the selfie is alive and matches it. */
  verify(checkId: string, images: IdentityImages): Promise<IdentityDecision>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
