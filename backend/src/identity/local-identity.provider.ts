import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdentityDecision,
  IdentityProvider,
  IdentitySession,
} from './identity-provider';

/**
 * Developer machines only: no document is read, every check goes to the
 * team with sample data so the back-office can be tried. Never enabled in
 * production.
 */
@Injectable()
export class LocalIdentityProvider implements IdentityProvider {
  readonly name = 'local';

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return process.env.NODE_ENV !== 'production';
  }

  createSession(checkId: string): Promise<IdentitySession> {
    const web = this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
    return Promise.resolve({
      sessionId: `local-${checkId}`,
      url: `${web}/identite?demo=1`,
    });
  }

  decision(): Promise<IdentityDecision> {
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
