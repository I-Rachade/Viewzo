import { Injectable } from '@nestjs/common';
import { IdentityDecision, IdentityProvider } from './identity-provider';

/**
 * Developer machines only: no document is read, every check goes to the
 * team with sample data so the back-office can be tried. Never enabled in
 * production.
 */
@Injectable()
export class LocalIdentityProvider implements IdentityProvider {
  readonly name = 'local';

  get enabled() {
    return process.env.NODE_ENV !== 'production';
  }

  verify(): Promise<IdentityDecision> {
    return Promise.resolve({
      providerStatus: 'In Review',
      outcome: 'IN_REVIEW',
      fullName: 'Démo Viewzo',
      dateOfBirth: '1995-01-01',
      documentType: 'Identity Card',
      documentCountry: 'TGO',
      livenessScore: 90,
      faceMatchScore: 90,
      warnings: ['Mode démo : aucune pièce lue'],
    });
  }
}
