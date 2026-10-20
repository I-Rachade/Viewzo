import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PostsScheduler } from '../src/posts/posts.scheduler';
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

const day = 24 * 3600 * 1000;
const hour = 3600 * 1000;

// Smallest valid PNG, with a varying last byte so hashes differ.
const png = (n: number) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`viewzo-proof-${n}`),
  ]);

interface Dossier {
  reviewStatus: string;
  riskScore: number;
  signals: { code: string }[];
  proofs: { kind: string; fileUrl: string | null; deviceId: string | null }[];
  snapshots: { views: number; source: string }[];
  timeline: { label: string }[];
  creator: { history: { validated: number }; account: { handle: string } };
  validViews: number;
}

describe('Posts, proofs and reports (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let staff: string;
  let creator: string;
  let other: string;
  let advertiser: string;
  let creatorId: string;
  let otherId: string;
  let campaignId: string;
  let statusTaskId: string;
  let tiktokTaskId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const res = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: sms.last.get(phone) })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'viewzo-proofs-'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
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
    creator = await login('+22895000002');
    other = await login('+22895000003');
    advertiser = await login('+22895000004');
    await prisma.user.update({
      where: { phone: '+22895000001' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
    const ids = await prisma.user.findMany({
      where: {
        phone: { in: ['+22895000002', '+22895000003', '+22895000004'] },
      },
      orderBy: { phone: 'asc' },
    });
    [creatorId, otherId] = [ids[0].id, ids[1].id];
    for (const u of [ids[0], ids[1]]) {
      await prisma.userProfile.create({
        data: { userId: u.id, type: 'CREATOR', level: 2 },
      });
    }
    await prisma.socialAccount.createMany({
      data: [
        {
          userId: creatorId,
          network: 'WHATSAPP_STATUS',
          handle: '+22895000002',
          handleKey: '22895000002',
          verificationCode: 'VZ-900001',
          status: 'ELIGIBLE',
          avgStatusViews: 1000,
        },
        {
          userId: creatorId,
          network: 'TIKTOK',
          handle: '@ama',
          handleKey: 'ama',
          verificationCode: 'VZ-900002',
          status: 'ELIGIBLE',
          followers: 5000,
        },
      ],
    });
    const campaign = await prisma.campaign.create({
      data: {
        advertiserId: ids[2].id,
        code: 'VZ7001',
        title: 'Lait Bonnet',
        objective: 'AWARENESS',
        countries: ['TG'],
        startsAt: new Date(Date.now() - day),
        endsAt: new Date(Date.now() + 5 * day),
        package: 'BASIC',
        budget: 60_000,
        contentCase: 'READY',
        language: 'Français',
        status: 'ACTIVE',
        fundedAt: new Date(),
        tasks: {
          create: [
            {
              network: 'WHATSAPP_STATUS',
              contentType: 'PROVIDED_ASSETS',
              budget: 30_000,
              position: 0,
              creatorRatePer1000: 400,
            },
            {
              network: 'TIKTOK',
              contentType: 'PROVIDED_ASSETS',
              budget: 30_000,
              position: 1,
              creatorRatePer1000: 400,
            },
          ],
        },
      },
      include: { tasks: { orderBy: { position: 'asc' } } },
    });
    campaignId = campaign.id;
    [statusTaskId, tiktokTaskId] = campaign.tasks.map((t) => t.id);
  });

  afterAll(async () => {
    await app.close();
  });

  async function assignment(taskId: string, creatorId: string, hoursAgo = 2) {
    return prisma.taskAssignment.create({
      data: {
        taskId,
        creatorId,
        acceptedAt: new Date(Date.now() - hoursAgo * hour),
      },
    });
  }

  it('takes screenshots of a statut and plans the next ones', async () => {
    const a = await assignment(statusTaskId, creatorId);
    await http()
      .post(`/me/assignments/${a.id}/proofs`)
      .set(auth(creator))
      .field('declaredViews', '15')
      .attach('file', Buffer.from('not an image at all'), 'x.png')
      .expect(400);
    await http()
      .post(`/me/assignments/${a.id}/proofs`)
      .set(auth(other))
      .field('declaredViews', '15')
      .attach('file', png(1), 'x.png')
      .expect(404);
    await http()
      .post(`/me/assignments/${a.id}/proofs`)
      .set({ ...auth(creator), 'X-Device-Id': 'device-a' })
      .field('declaredViews', '15')
      .field('capturedAt', new Date().toISOString())
      .attach('file', png(1), 'x.png')
      .expect(201);

    const mine = await http()
      .get('/me/assignments')
      .set(auth(creator))
      .expect(200);
    const view = (
      mine.body as {
        id: string;
        status: string;
        reviewStatus: string;
        declaredViews: number;
        proofs: { fileUrl: string }[];
        proofPlan: { steps: { doneAt: string | null }[]; nextDueAt: string };
      }[]
    ).find((x) => x.id === a.id)!;
    expect(view).toMatchObject({
      status: 'SUBMITTED',
      reviewStatus: 'TO_REVIEW',
      declaredViews: 15,
    });
    expect(view.proofPlan.steps.map((s) => !!s.doneAt)).toEqual([
      true,
      false,
      false,
    ]);

    // The screenshot opens from its signed link only.
    const url = new URL(view.proofs[0].fileUrl);
    await http()
      .get(`${url.pathname}${url.search}`)
      .expect(200)
      .expect('Content-Type', 'image/png');
    await http()
      .get(`${url.pathname}?exp=${url.searchParams.get('exp')}&sig=forged`)
      .expect(401);
  });

  it('flags the same screenshot sent for another post', async () => {
    const a = await assignment(statusTaskId, otherId);
    await http()
      .post(`/me/assignments/${a.id}/proofs`)
      .set({ ...auth(other), 'X-Device-Id': 'device-a' })
      .field('declaredViews', '15')
      .attach('file', png(1), 'x.png')
      .expect(201);
    const dossier = (
      await http().get(`/staff/posts/${a.id}`).set(auth(staff)).expect(200)
    ).body as Dossier;
    expect(dossier.signals.map((s) => s.code)).toEqual(
      expect.arrayContaining([
        'DUPLICATE_IMAGE',
        'MISSING_CAPTURE_TIME',
        'SHARED_DEVICE',
      ]),
    );
    expect(dossier.riskScore).toBeGreaterThanOrEqual(50);

    const list = await http().get('/staff/posts').set(auth(staff)).expect(200);
    const body = list.body as {
      items: { id: string }[];
      counts: Record<string, number>;
    };
    expect(body.items[0].id).toBe(a.id);
    expect(body.counts.TO_REVIEW).toBe(2);
    // The first post with that image is flagged too.
    expect(
      (await http().get('/staff/overview').set(auth(staff)).expect(200)).body,
    ).toMatchObject({ assignments: 2, alerts: 2 });
    await http().get('/staff/posts').set(auth(creator)).expect(403);
  });

  it('asks for a fix, takes a new proof, then validates and pays', async () => {
    const a = await assignment(tiktokTaskId, creatorId);
    await http()
      .post(`/me/assignments/${a.id}/submit`)
      .set(auth(creator))
      .send({
        postUrl: 'https://www.tiktok.com/@ama/video/7300000000000000001',
      })
      .expect(200);

    await http()
      .post(`/staff/posts/${a.id}/review`)
      .set(auth(staff))
      .send({ decision: 'NEEDS_FIX' })
      .expect(400);
    await http()
      .post(`/staff/posts/${a.id}/review`)
      .set(auth(staff))
      .send({ decision: 'NEEDS_FIX', reason: 'Le hashtag #VZ7001 manque' })
      .expect(200);
    let mine = (await http().get('/me/assignments').set(auth(creator)))
      .body as {
      id: string;
      reviewStatus: string;
      reviewReason: string | null;
    }[];
    expect(mine.find((x) => x.id === a.id)).toMatchObject({
      reviewStatus: 'NEEDS_FIX',
      reviewReason: 'Le hashtag #VZ7001 manque',
    });

    await http()
      .post(`/me/assignments/${a.id}/proofs`)
      .set(auth(creator))
      .field('declaredViews', '4000')
      .field('capturedAt', new Date().toISOString())
      .attach('file', png(2), 'x.png')
      .expect(201);
    mine = (await http().get('/me/assignments').set(auth(creator)))
      .body as typeof mine;
    expect(mine.find((x) => x.id === a.id)!.reviewStatus).toBe('TO_REVIEW');

    const dossier = (
      await http()
        .post(`/staff/posts/${a.id}/review`)
        .set(auth(staff))
        .send({ decision: 'VALIDATE', views: 4000 })
        .expect(200)
    ).body as Dossier;
    expect(dossier).toMatchObject({
      reviewStatus: 'VALIDATED',
      validViews: 4000,
    });
    expect(dossier.snapshots.map((s) => s.source)).toEqual([
      'CREATOR',
      'STAFF',
    ]);
    expect(dossier.timeline.map((t) => t.label)).toEqual(
      expect.arrayContaining([
        'Tâche acceptée',
        'Lien envoyé',
        'Correction demandée · Le hashtag #VZ7001 manque',
        `Vues validées · ${(4000).toLocaleString('fr-FR')} vues`,
      ]),
    );

    const results = await http()
      .get('/me/results')
      .set(auth(creator))
      .expect(200);
    expect(results.body).toMatchObject({
      validViews: 4000,
      earned: 1600,
      earnedThisMonth: 1600,
      validated: 1,
      toReview: 1,
    });

    const notes = await http()
      .get('/me/notifications')
      .set(auth(creator))
      .expect(200);
    const n = notes.body as { unread: number; items: { type: string }[] };
    expect(n.items.map((i) => i.type)).toEqual([
      'POST_VALIDATED',
      'POST_NEEDS_FIX',
    ]);
    expect(n.unread).toBe(2);
    await http()
      .post('/me/notifications/read')
      .set(auth(creator))
      .send({})
      .expect(200, { unread: 0 });
  });

  it('shows the advertiser a report with only validated posts', async () => {
    await http()
      .get(`/me/campaigns/${campaignId}/report`)
      .set(auth(creator))
      .expect(404);
    const report = await http()
      .get(`/me/campaigns/${campaignId}/report`)
      .set(auth(advertiser))
      .expect(200);
    expect(report.body).toMatchObject({
      verifiedViews: 4000,
      posts: { total: 3, validated: 1, toReview: 2, rejected: 0 },
      byNetwork: [{ network: 'TIKTOK', views: 4000, posts: 1 }],
      byCountry: [{ country: 'TG', views: 4000, posts: 1 }],
    });
    const gallery = (
      report.body as { gallery: { handle: string; imageUrl: string }[] }
    ).gallery;
    expect(gallery).toHaveLength(1);
    expect(gallery[0].handle).toBe('@ama');
    expect(gallery[0].imageUrl).toContain('/files/proofs/');
  });

  it('rejects a paid post and takes the held earnings back', async () => {
    const a = await prisma.taskAssignment.findFirstOrThrow({
      where: { creatorId, taskId: tiktokTaskId },
    });
    const before = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    await http()
      .post(`/staff/posts/${a.id}/review`)
      .set(auth(staff))
      .send({ decision: 'REJECT', reason: 'Vues achetées' })
      .expect(200);
    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    expect(after.spent).toBeLessThan(before.spent);
    const earning = await prisma.transaction.findFirstOrThrow({
      where: { assignmentId: a.id, type: 'EARNING' },
    });
    expect(earning.status).toBe('CANCELLED');
    await http()
      .post(`/me/assignments/${a.id}/submit`)
      .set(auth(creator))
      .send({
        postUrl: 'https://www.tiktok.com/@ama/video/7300000000000000002',
      })
      .expect(403);
  });

  it('suspends the account and builds the creator file', async () => {
    const a = await prisma.taskAssignment.findFirstOrThrow({
      where: { creatorId, taskId: statusTaskId },
    });
    await http()
      .post(`/staff/posts/${a.id}/review`)
      .set(auth(staff))
      .send({ decision: 'SUSPEND_ACCOUNT', reason: 'Captures retouchées' })
      .expect(200);
    const account = await prisma.socialAccount.findFirstOrThrow({
      where: { userId: creatorId, network: 'WHATSAPP_STATUS' },
    });
    expect(account.status).toBe('SUSPENDED');

    const file = await http()
      .get(`/staff/creators/${creatorId}`)
      .set(auth(staff))
      .expect(200);
    const body = file.body as {
      posts: unknown[];
      accounts: unknown[];
      accountReviews: { status: string }[];
      sharedDevice: { id: string }[];
    };
    expect(body.posts).toHaveLength(2);
    expect(body.accounts).toHaveLength(2);
    expect(body.accountReviews[0].status).toBe('SUSPENDED');
    expect(body.sharedDevice.map((u) => u.id)).toEqual([otherId]);
  });

  it('reminds both statut creators of each next screenshot once', async () => {
    const scheduler = app.get(PostsScheduler);
    const a = await prisma.taskAssignment.findFirstOrThrow({
      where: { creatorId: otherId, taskId: statusTaskId },
    });
    expect(await scheduler.sendReminders(new Date(Date.now() + 6 * hour))).toBe(
      0,
    );
    expect(
      await scheduler.sendReminders(new Date(Date.now() + 12.5 * hour)),
    ).toBe(2);
    expect(
      await scheduler.sendReminders(new Date(Date.now() + 13 * hour)),
    ).toBe(0);
    expect(
      await scheduler.sendReminders(new Date(Date.now() + 23.2 * hour)),
    ).toBe(2);
    const notes = await prisma.notification.findMany({
      where: { userId: otherId, type: 'PROOF_REMINDER' },
    });
    expect(notes).toHaveLength(2);
    expect(
      (await prisma.taskAssignment.findUniqueOrThrow({ where: { id: a.id } }))
        .remindersSent,
    ).toBe(2);
  });

  it('lists platform connections and refuses forged callbacks', async () => {
    const list = await http()
      .get('/me/connections')
      .set(auth(creator))
      .expect(200);
    expect(
      (list.body as { network: string; available: boolean }[]).map(
        (c) => c.network,
      ),
    ).toEqual(['TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'THREADS']);
    // No platform app configured in tests.
    await http()
      .get('/me/connections/TIKTOK/start')
      .set(auth(creator))
      .expect(400);
    // Configured apps stay unused while connecting by login is switched off.
    process.env.TIKTOK_CLIENT_KEY = 'key';
    process.env.TIKTOK_CLIENT_SECRET = 'secret';
    try {
      await http()
        .get('/me/connections/TIKTOK/start')
        .set(auth(creator))
        .expect(400);
    } finally {
      delete process.env.TIKTOK_CLIENT_KEY;
      delete process.env.TIKTOK_CLIENT_SECRET;
    }
    const res = await http()
      .get('/connections/tiktok/callback?code=abc&state=forged.sig')
      .expect(302);
    expect(res.headers.location).toContain(
      '/connexions?network=TIKTOK&status=error',
    );
  });
});
