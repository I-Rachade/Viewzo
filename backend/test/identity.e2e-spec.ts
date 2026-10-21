import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import {
  IDENTITY_PROVIDER,
  IdentityDecision,
  IdentityImages,
  IdentityProvider,
} from '../src/identity/identity-provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';
import { SMS_SENDER, SmsSender } from '../src/sms/sms-sender';

class CapturingSmsSender implements SmsSender {
  last = new Map<string, string>();
  send(phone: string, message: string) {
    this.last.set(phone, message.match(/\d{6}/)![0]);
    return Promise.resolve();
  }
}

const IN_REVIEW: IdentityDecision = {
  providerStatus: 'In Review',
  outcome: 'IN_REVIEW',
  fullName: 'Kossi Mensah',
  warnings: ['Photo floue'],
};

// Stands in for Didit: each test says what the next decision will be.
class FakeProvider implements IdentityProvider {
  readonly name = 'fake';
  enabled = true;
  next: IdentityDecision = IN_REVIEW;
  calls = 0;
  last?: IdentityImages;
  verify(_checkId: string, images: IdentityImages) {
    this.calls += 1;
    this.last = images;
    return Promise.resolve(this.next);
  }
}

// Smallest valid PNG and JPEG headers: the type is read from the bytes.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32),
]);

describe('Identity verification (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const provider = new FakeProvider();
  let staff: string;
  let moderatorBenin: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(phone: string, profile = 'CREATOR') {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const res = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: sms.last.get(phone) })
      .expect(200);
    const token = (res.body as { accessToken: string }).accessToken;
    await http()
      .post('/me/profiles')
      .set(auth(token))
      .send({ type: profile })
      .expect(201);
    return token;
  }

  // Front, back and selfie, as the web and the app send them.
  const submit = (token: string, back = true) => {
    const req = http()
      .post('/me/identity')
      .set(auth(token))
      .attach('front', PNG, 'front.png')
      .attach('selfie', JPEG, 'selfie.jpg');
    return back ? req.attach('back', PNG, 'back.png') : req;
  };

  const levels = async (token: string) =>
    (
      (await http().get('/me').set(auth(token)).expect(200)).body as {
        profiles: { type: string; level: number }[];
      }
    ).profiles;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
      .overrideProvider(IDENTITY_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.transaction.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.user.deleteMany();
    await prisma.countryCounter.deleteMany();
    await prisma.otpChallenge.deleteMany();

    staff = await login('+22895000001');
    moderatorBenin = await login('+22895000002');
    await prisma.user.update({
      where: { phone: '+22895000001' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
    await prisma.user.update({
      where: { phone: '+22895000002' },
      data: { role: 'STAFF', staffRole: 'MODERATOR', staffCountries: ['BJ'] },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends a creator to the provider, then to the team', async () => {
    const creator = await login('+22895000010');
    const empty = await http().get('/me/identity').set(auth(creator));
    expect(empty.body).toMatchObject({
      available: true,
      verified: false,
      check: null,
    });

    // The selfie and a real image are required; the type comes from the bytes.
    await http()
      .post('/me/identity')
      .set(auth(creator))
      .attach('front', PNG, 'front.png')
      .expect(400);
    await http()
      .post('/me/identity')
      .set(auth(creator))
      .attach('front', Buffer.from('not an image at all'), 'front.png')
      .attach('selfie', JPEG, 'selfie.jpg')
      .expect(400);
    expect(provider.calls).toBe(0);

    provider.next = IN_REVIEW;
    const sent = await submit(creator).expect(200);
    const check = sent.body as { id: string };
    expect(sent.body).toMatchObject({
      status: 'IN_REVIEW',
      fullName: 'Kossi Mensah',
    });
    expect(provider.last).toMatchObject({
      front: { mimeType: 'image/png' },
      back: { mimeType: 'image/png' },
      selfie: { mimeType: 'image/jpeg' },
    });
    await submit(creator).expect(409);

    // Only the team decides now, within its countries, never on itself.
    await http().get('/staff/identity').set(auth(creator)).expect(403);
    const queue = await http()
      .get('/staff/identity')
      .set(auth(staff))
      .expect(200);
    expect(queue.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: check.id, reason: 'Photo floue' }),
      ]),
    );
    await http()
      .post(`/staff/identity/${check.id}/review`)
      .set(auth(moderatorBenin))
      .send({ decision: 'APPROVE' })
      .expect(403);
    await http()
      .post(`/staff/identity/${check.id}/review`)
      .set(auth(staff))
      .send({ decision: 'DECLINE' })
      .expect(400);
    const declined = await http()
      .post(`/staff/identity/${check.id}/review`)
      .set(auth(staff))
      .send({ decision: 'DECLINE', reason: 'Pièce expirée' })
      .expect(200);
    expect(declined.body).toMatchObject({
      status: 'DECLINED',
      reason: 'Pièce expirée',
    });
    await http()
      .post(`/staff/identity/${check.id}/review`)
      .set(auth(staff))
      .send({ decision: 'APPROVE' })
      .expect(409);
    expect(await levels(creator)).toEqual([{ type: 'CREATOR', level: 1 }]);

    // A new try, approved by the team: level 2 and withdrawals open.
    const retry = await submit(creator, false).expect(200);
    const retryId = (retry.body as { id: string }).id;
    expect(retryId).not.toBe(check.id);
    expect(provider.last?.back).toBeUndefined();
    await http()
      .post(`/staff/identity/${retryId}/review`)
      .set(auth(staff))
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(await levels(creator)).toEqual([{ type: 'CREATOR', level: 2 }]);
    const wallet = await http().get('/me/wallet').set(auth(creator));
    expect(wallet.body).toMatchObject({ withdrawalsOpen: true });

    // A profile activated later is verified too.
    await http()
      .post('/me/profiles')
      .set(auth(creator))
      .send({ type: 'ADVERTISER' })
      .expect(201);
    expect(await levels(creator)).toEqual(
      expect.arrayContaining([{ type: 'ADVERTISER', level: 2 }]),
    );

    const journal = await prisma.auditLog.findMany({
      where: { entity: 'IdentityCheck', entityId: retryId },
    });
    expect(journal.map((j) => j.action)).toContain('identity.approve');
    const bell = await prisma.notification.findMany({
      where: { type: 'IDENTITY_REVIEWED' },
    });
    expect(bell.length).toBeGreaterThanOrEqual(3);
  });

  it('approves on its own when the provider does, once per document', async () => {
    const first = await login('+22895000020', 'ADVERTISER');
    provider.next = {
      providerStatus: 'Approved',
      outcome: 'APPROVED',
      fullName: 'Akouvi Ékué',
      firstName: 'Akouvi',
      documentNumber: 'TG-123 456',
      warnings: [],
    };
    const approved = await submit(first).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED' });
    expect(await levels(first)).toEqual([{ type: 'ADVERTISER', level: 2 }]);
    // Greeted by the first name on the ID.
    const me = await http().get('/me').set(auth(first)).expect(200);
    expect(me.body).toMatchObject({ firstName: 'Akouvi' });
    const row = await prisma.identityCheck.findFirstOrThrow({
      where: { user: { phone: '+22895000020' } },
    });
    expect(row.documentNumberLast4).toBe('3456');
    expect(row.documentNumberHash).toHaveLength(64);

    // The same document on another account goes to the team.
    const second = await login('+22895000021');
    await submit(second).expect(200);
    const status = await http().get('/me/identity').set(auth(second));
    expect(status.body).toMatchObject({
      verified: false,
      check: {
        status: 'IN_REVIEW',
        reason: 'Cette pièce est déjà utilisée par un autre compte',
      },
    });
    const queue = await http()
      .get('/staff/identity')
      .set(auth(staff))
      .expect(200);
    const flagged = (
      queue.body as { userId: string; sameDocumentUsers: string[] }[]
    ).find((c) => c.sameDocumentUsers.length > 0);
    expect(flagged?.sameDocumentUsers).toEqual([row.userId]);
  });

  it('shows the finance team whether the Mobile Money name matches', async () => {
    const holder = await prisma.user.findUniqueOrThrow({
      where: { phone: '+22895000020' },
    });
    for (const [i, name] of ['Ekue Akouvi', 'Yao Agbeko'].entries()) {
      await prisma.payment.create({
        data: {
          userId: holder.id,
          kind: 'PAYOUT',
          provider: 'local',
          reference: `id-test-${i}`,
          amount: 5000,
          phone: '+22895000020',
          beneficiaryName: name,
          status: 'REQUESTED',
        },
      });
    }
    const res = await http()
      .get('/staff/withdrawals')
      .set(auth(staff))
      .expect(200);
    const rows = res.body as {
      beneficiaryName: string;
      verifiedName: string;
      nameMatches: boolean;
    }[];
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          beneficiaryName: 'Ekue Akouvi',
          verifiedName: 'Akouvi Ékué',
          nameMatches: true,
        }),
        expect.objectContaining({
          beneficiaryName: 'Yao Agbeko',
          nameMatches: false,
        }),
      ]),
    );
  });

  it('declines, then asks to wait after three refusals', async () => {
    const creator = await login('+22895000030');
    provider.next = {
      providerStatus: 'Declined',
      outcome: 'DECLINED',
      warnings: [],
    };
    for (let i = 0; i < 3; i++) {
      const res = await submit(creator).expect(200);
      expect(res.body).toMatchObject({ status: 'DECLINED' });
    }
    const calls = provider.calls;
    const blocked = await submit(creator).expect(403);
    expect(blocked.body).toMatchObject({ code: 'IDENTITY_RETRY_LATER' });
    expect(provider.calls).toBe(calls);
  });

  it('limits tries per day, and keeps a failed call from blocking the next', async () => {
    const creator = await login('+22895000050');
    const failing = jest
      .spyOn(provider, 'verify')
      .mockRejectedValueOnce(new Error('Didit down'));
    await submit(creator).expect(500);
    failing.mockRestore();
    const status = await http().get('/me/identity').set(auth(creator));
    expect(status.body).toMatchObject({ check: { status: 'ABANDONED' } });

    provider.next = {
      providerStatus: 'Declined',
      outcome: 'DECLINED',
      warnings: [],
    };
    // Two declined only (not the 30-day limit), but five tries today.
    const user = await prisma.user.findUniqueOrThrow({
      where: { phone: '+22895000050' },
    });
    await prisma.identityCheck.createMany({
      data: [1, 2, 3].map(() => ({
        userId: user.id,
        provider: 'fake',
        status: 'ABANDONED' as const,
      })),
    });
    await submit(creator).expect(200);
    const blocked = await submit(creator).expect(403);
    expect(blocked.body).toMatchObject({
      message: 'Trop d’essais aujourd’hui : réessaie demain',
    });
  });

  it('stays closed while the provider is not set up', async () => {
    const creator = await login('+22895000040');
    provider.enabled = false;
    try {
      const res = await submit(creator).expect(503);
      expect(res.body).toMatchObject({ code: 'IDENTITY_CLOSED' });
      const status = await http().get('/me/identity').set(auth(creator));
      expect(status.body).toMatchObject({ available: false });
    } finally {
      provider.enabled = true;
    }
  });
});
