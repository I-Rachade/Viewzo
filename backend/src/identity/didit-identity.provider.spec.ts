import { mapDiditDecision } from './didit-identity.provider';

const approvedId = {
  id_verification: {
    status: 'Approved',
    first_name: 'Awa',
    last_name: 'Koné',
    date_of_birth: '1998-04-12',
    document_type: 'Identity Card',
    issuing_state: 'CIV',
    document_number: 'C0012345',
    warnings: [],
  },
};
const approvedLiveness = { liveness: { status: 'Approved', score: 97 } };
const approvedFace = { face_match: { status: 'Approved', score: 91 } };

describe('mapDiditDecision', () => {
  it('approves when the document, liveness and face match are all approved', () => {
    const d = mapDiditDecision({
      id: approvedId,
      liveness: approvedLiveness,
      face: approvedFace,
    });
    expect(d.outcome).toBe('APPROVED');
    expect(d.providerStatus).toBe('Approved');
    expect(d.fullName).toBe('Awa Koné');
    expect(d.firstName).toBe('Awa');
    expect(d.dateOfBirth).toBe('1998-04-12');
    expect(d.documentCountry).toBe('CIV');
    expect(d.documentNumber).toBe('C0012345');
    expect(d.livenessScore).toBe(97);
    expect(d.faceMatchScore).toBe(91);
    expect(d.warnings).toEqual([]);
  });

  it('declines as soon as one part is declined', () => {
    const d = mapDiditDecision({
      id: approvedId,
      liveness: approvedLiveness,
      face: {
        face_match: {
          status: 'Declined',
          score: 12,
          warnings: [{ risk: 'LOW_FACE_MATCH_SIMILARITY' }],
        },
      },
    });
    expect(d.outcome).toBe('DECLINED');
    expect(d.warnings).toEqual(['LOW_FACE_MATCH_SIMILARITY']);
  });

  it('sends doubtful or missing parts to review', () => {
    expect(
      mapDiditDecision({
        id: approvedId,
        liveness: { liveness: { status: 'In Review' } },
        face: approvedFace,
      }).outcome,
    ).toBe('IN_REVIEW');
    expect(
      mapDiditDecision({ id: approvedId, liveness: approvedLiveness }).outcome,
    ).toBe('IN_REVIEW');
  });

  it('reads flat answers, lists and the passive_liveness key', () => {
    const d = mapDiditDecision({
      id: {
        status: 'Approved',
        full_name: '  Jean Dupont ',
        personal_number: 'P-77',
        warnings: [
          { short_description: 'Document expire bientôt' },
          { short_description: 'Document expire bientôt' },
        ],
      },
      liveness: { passive_liveness: [{ status: 'approved', score: 80 }] },
      face: { status: 'APPROVED', score: 88 },
    });
    expect(d.outcome).toBe('APPROVED');
    expect(d.fullName).toBe('Jean Dupont');
    expect(d.documentNumber).toBe('P-77');
    expect(d.livenessScore).toBe(80);
    expect(d.warnings).toEqual(['Document expire bientôt']);
  });
});
