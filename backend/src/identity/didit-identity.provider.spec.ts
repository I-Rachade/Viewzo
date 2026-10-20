import { mapDiditDecision } from './didit-identity.provider';

describe('mapDiditDecision', () => {
  it('reads the newer answer with one list per feature', () => {
    const d = mapDiditDecision({
      status: 'Approved',
      id_verifications: [
        {
          first_name: 'Kossi',
          last_name: 'Mensah',
          date_of_birth: '1994-03-02',
          document_type: 'Identity Card',
          issuing_state: 'TGO',
          document_number: 'A123',
        },
      ],
      liveness_checks: [{ score: 97.5 }],
      face_matches: [{ score: 88 }],
    });
    expect(d).toMatchObject({
      outcome: 'APPROVED',
      fullName: 'Kossi Mensah',
      documentCountry: 'TGO',
      documentNumber: 'A123',
      livenessScore: 97.5,
      faceMatchScore: 88,
    });
  });

  it('reads the older answer with one object per feature and its warnings', () => {
    const d = mapDiditDecision({
      status: 'In Review',
      id_verification: {
        full_name: 'Akouvi Ekue',
        warnings: [{ short_description: 'Document expiré' }],
      },
      liveness: { warnings: [{ risk: 'LOW_LIVENESS_SCORE' }] },
    });
    expect(d).toMatchObject({
      outcome: 'IN_REVIEW',
      fullName: 'Akouvi Ekue',
      warnings: ['Document expiré', 'LOW_LIVENESS_SCORE'],
    });
  });

  it('maps the other statuses', () => {
    expect(mapDiditDecision({ status: 'Declined' }).outcome).toBe('DECLINED');
    expect(mapDiditDecision({ status: 'Expired' }).outcome).toBe('ABANDONED');
    expect(mapDiditDecision({ status: 'In Progress' }).outcome).toBe('PENDING');
    expect(mapDiditDecision({}).outcome).toBe('PENDING');
  });
});
