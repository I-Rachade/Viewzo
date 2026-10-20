import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
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

interface AccountView {
  id: string;
  network: string;
  status: string;
  statusReason: string | null;
  retryAfter: string | null;
  reviewDueAt: string | null;
  verification: {
    kind: string;
    code: string;
    contactNumber?: string;
    whatsappLink?: string;
  } | null;
}

describe('Creator accounts and skills (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let creator: string;
  let staff: string;

  beforeAll(async () => {
    process.env.WHATSAPP_VERIFICATION_NUMBERS = 'TG:+22890000000';
    process.env.YOUTUBE_API_KEY = 'test-key';
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

    creator = await login('+22891000001');
    staff = await login('+22891000002');
    await prisma.user.update({
      where: { phone: '+22891000002' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
  });

  afterAll(async () => {
    delete process.env.YOUTUBE_API_KEY;
    await app.close();
  });

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

  it('requires the creator profile to add an account', async () => {
    await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({ network: 'TIKTOK', handle: '@ama', notAnonymous: true })
      .expect(403);
    await http()
      .post('/me/profiles')
      .set(auth(creator))
      .send({ type: 'CREATOR' })
      .expect(201);
  });

  it('adds a network with a bio code and keeps one account per network', async () => {
    // The creator must confirm the account is theirs and not anonymous.
    await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({ network: 'TIKTOK', handle: '@ama' })
      .expect(400);
    await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({ network: 'TIKTOK', handle: 'not a name!', notAnonymous: true })
      .expect(400);
    const res = await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({ network: 'TIKTOK', handle: '@ama', notAnonymous: true })
      .expect(201);
    const account = res.body as AccountView;
    expect(account.status).toBe('PENDING');
    expect(account.reviewDueAt).not.toBeNull();
    expect(account.verification).toEqual({
      kind: 'BIO_CODE',
      code: expect.stringMatching(/^VZ-\d{6}$/) as string,
    });

    await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({ network: 'TIKTOK', handle: '@other', notAnonymous: true })
      .expect(409);
  });

  it('gives WhatsApp Statut the verification number and prefilled message', async () => {
    const res = await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({
        network: 'WHATSAPP_STATUS',
        handle: '+22891000001',
        notAnonymous: true,
      })
      .expect(201);
    const { verification } = res.body as AccountView;
    expect(verification).toMatchObject({
      kind: 'WHATSAPP',
      contactNumber: '+22890000000',
    });
    expect(verification!.whatsappLink).toContain('https://wa.me/22890000000');
    expect(decodeURIComponent(verification!.whatsappLink!)).toContain(
      `Code : ${verification!.code}`,
    );

    const found = await http()
      .get(`/staff/accounts/by-code/${verification!.code}`)
      .set(auth(staff))
      .expect(200);
    expect(found.body).toMatchObject({
      network: 'WHATSAPP_STATUS',
      user: { phone: '+22891000001' },
    });
  });

  it('keeps back-office endpoints for staff only', async () => {
    await http().get('/staff/accounts').set(auth(creator)).expect(403);
    const res = await http()
      .get('/staff/accounts')
      .set(auth(staff))
      .expect(200);
    expect(res.body).toHaveLength(2);
  });

  it('keeps one account for one creator across Viewzo', async () => {
    const other = await login('+22891000003');
    await http()
      .post('/me/profiles')
      .set(auth(other))
      .send({ type: 'CREATOR' })
      .expect(201);
    // Same TikTok account, written as a profile link.
    const res = await http()
      .post('/me/accounts')
      .set(auth(other))
      .send({
        network: 'TIKTOK',
        handle: 'https://www.tiktok.com/@AMA?lang=fr',
        notAnonymous: true,
      })
      .expect(409);
    expect((res.body as { message: string }).message).toContain(
      'déjà inscrit sur Viewzo',
    );
  });

  it('refuses unknown accounts itself and fills in the followers it reads', async () => {
    const youtube = (items: object[]) =>
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ items })));

    const lookup = youtube([]);
    const ghost = await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({ network: 'YOUTUBE', handle: '@ghost', notAnonymous: true })
      .expect(201);
    expect(lookup.mock.calls[0][0] as string).toContain('forHandle=%40ghost');
    const refused = ghost.body as AccountView & { autoRejection: string };
    expect(refused).toMatchObject({
      status: 'NOT_ELIGIBLE',
      autoRejection: 'NOT_FOUND',
      retryAfter: null,
    });
    expect(refused.statusReason).toContain('Compte introuvable');
    const auto = await http()
      .get('/staff/accounts?auto=1')
      .set(auth(staff))
      .expect(200);
    expect((auto.body as { id: string }[]).map((a) => a.id)).toEqual([
      refused.id,
    ]);
    const review = await prisma.accountReview.findFirstOrThrow({
      where: { accountId: refused.id },
    });
    expect(review.reviewerId).toBeNull();
    // Wrong name: the creator removes it and adds the right one.
    await http()
      .delete(`/me/accounts/${refused.id}`)
      .set(auth(creator))
      .expect(204);

    youtube([
      {
        snippet: { title: 'Ama TV' },
        statistics: { subscriberCount: '4200', hiddenSubscriberCount: false },
      },
    ]);
    const added = await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({
        network: 'YOUTUBE',
        handle: 'youtube.com/@ama_tv',
        followers: 1500,
        notAnonymous: true,
      })
      .expect(201);
    const account = added.body as AccountView & { followers: number };
    expect(account).toMatchObject({ status: 'PENDING', followers: 4200 });
    const queue = await http()
      .get('/staff/accounts')
      .set(auth(staff))
      .expect(200);
    expect(
      (queue.body as { id: string }[]).find((a) => a.id === account.id),
    ).toMatchObject({
      handle: 'ama_tv',
      profileUrl: 'https://www.youtube.com/@ama_tv',
      declaredFollowers: 1500,
      followersSource: 'SYSTEM',
      notAnonymousConfirmed: true,
      otherAccounts: expect.arrayContaining([
        expect.objectContaining({ network: 'TIKTOK' }),
      ]) as unknown,
    });
    // The count the system read is enough to approve.
    await http()
      .post(`/staff/accounts/${account.id}/review`)
      .set(auth(staff))
      .send({ status: 'ELIGIBLE' })
      .expect(200);
  });

  it('refuses anonymous accounts the platform shows without name or picture', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    try {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, result: { title: ' ' } })),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, result: 2500 })),
        );
      const res = await http()
        .post('/me/accounts')
        .set(auth(creator))
        .send({
          network: 'TELEGRAM',
          handle: 't.me/canal_x',
          notAnonymous: true,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'NOT_ELIGIBLE',
        autoRejection: 'ANONYMOUS',
        followers: 2500,
      });
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  });

  it('makes WhatsApp Statut eligible only from 300 average views', async () => {
    const list = await http().get('/me/accounts').set(auth(creator));
    const whatsapp = (list.body as AccountView[]).find(
      (a) => a.network === 'WHATSAPP_STATUS',
    )!;
    await http()
      .post(`/staff/accounts/${whatsapp.id}/review`)
      .set(auth(staff))
      .send({ status: 'ELIGIBLE', avgStatusViews: 250 })
      .expect(400);
    await http()
      .post(`/staff/accounts/${whatsapp.id}/review`)
      .set(auth(staff))
      .send({ status: 'ELIGIBLE', avgStatusViews: 320 })
      .expect(200);
  });

  it('walks an account through review, correction and the 30-day wait', async () => {
    const list = await http().get('/me/accounts').set(auth(creator));
    const tiktok = (list.body as AccountView[]).find(
      (a) => a.network === 'TIKTOK',
    )!;

    await http()
      .post(`/staff/accounts/${tiktok.id}/review`)
      .set(auth(staff))
      .send({ status: 'NEEDS_FIX' })
      .expect(400);
    await http()
      .post(`/staff/accounts/${tiktok.id}/review`)
      .set(auth(staff))
      .send({ status: 'NEEDS_FIX', reason: 'Code absent de la bio' })
      .expect(200);

    let mine = await http()
      .post(`/me/accounts/${tiktok.id}/resubmit`)
      .set(auth(creator))
      .expect(200);
    expect((mine.body as AccountView).status).toBe('PENDING');

    await http()
      .post(`/staff/accounts/${tiktok.id}/review`)
      .set(auth(staff))
      .send({ status: 'NOT_ELIGIBLE', reason: 'Moins de 1 000 abonnés' })
      .expect(200);
    mine = await http().get('/me/accounts').set(auth(creator));
    const refused = (mine.body as AccountView[]).find(
      (a) => a.id === tiktok.id,
    )!;
    expect(refused).toMatchObject({
      status: 'NOT_ELIGIBLE',
      statusReason: 'Moins de 1 000 abonnés',
      verification: null,
    });
    expect(new Date(refused.retryAfter!).getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 3600 * 1000,
    );
    await http()
      .post(`/me/accounts/${tiktok.id}/resubmit`)
      .set(auth(creator))
      .expect(400);
    await http()
      .delete(`/me/accounts/${tiktok.id}`)
      .set(auth(creator))
      .expect(403);

    await http()
      .post(`/staff/accounts/${tiktok.id}/review`)
      .set(auth(staff))
      .send({ status: 'ELIGIBLE', followers: 999 })
      .expect(400);
    await http()
      .post(`/staff/accounts/${tiktok.id}/review`)
      .set(auth(staff))
      .send({ status: 'ELIGIBLE', followers: 1000 })
      .expect(200);
    await http()
      .delete(`/me/accounts/${tiktok.id}`)
      .set(auth(creator))
      .expect(204);

    // The decisions stay in the audit trail after the account is removed.
    const reviews = await prisma.accountReview.findMany({
      where: { network: 'TIKTOK' },
    });
    expect(reviews.map((r) => r.status)).toEqual(
      expect.arrayContaining(['NEEDS_FIX', 'NOT_ELIGIBLE', 'ELIGIBLE']),
    );
    expect(reviews.every((r) => r.accountId === null)).toBe(true);
  });

  it('saves the skills form and requires examples for original videos', async () => {
    const base = {
      taskTypes: ['POST_PROVIDED_VIDEO', 'CREATE_ORIGINAL_VIDEO'],
      specialties: ['FACECAM', 'UNBOXING'],
      showsFace: true,
      phoneModel: 'Tecno Camon 30',
      languages: ['Français', 'Ewe'],
      countries: ['TG'],
      cities: ['Lomé'],
      themes: ['beauté', 'food'],
      tasksPerWeek: 4,
    };
    await http()
      .put('/me/skills')
      .set(auth(creator))
      .send({ ...base, exampleLinks: ['https://tiktok.com/@ama/video/1'] })
      .expect(400);

    const links = [1, 2, 3].map((i) => `https://tiktok.com/@ama/video/${i}`);
    const res = await http()
      .put('/me/skills')
      .set(auth(creator))
      .send({ ...base, exampleLinks: links })
      .expect(200);
    expect(res.body).toMatchObject({ exampleLinks: links, tasksPerWeek: 4 });

    const read = await http().get('/me/skills').set(auth(creator)).expect(200);
    expect(read.body).toMatchObject({ specialties: ['FACECAM', 'UNBOXING'] });
  });
});
