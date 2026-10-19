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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.deleteMany();
    await prisma.countryCounter.deleteMany();
    await prisma.otpChallenge.deleteMany();

    creator = await login('+22891000001');
    staff = await login('+22891000002');
    await prisma.user.update({
      where: { phone: '+22891000002' },
      data: { role: 'STAFF' },
    });
  });

  afterAll(async () => {
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
      .send({ network: 'TIKTOK', handle: '@ama' })
      .expect(403);
    await http()
      .post('/me/profiles')
      .set(auth(creator))
      .send({ type: 'CREATOR' })
      .expect(201);
  });

  it('adds a network with a bio code and keeps one account per network', async () => {
    const res = await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({ network: 'TIKTOK', handle: '@ama' })
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
      .send({ network: 'TIKTOK', handle: '@other' })
      .expect(409);
  });

  it('gives WhatsApp Statut the verification number and prefilled message', async () => {
    const res = await http()
      .post('/me/accounts')
      .set(auth(creator))
      .send({ network: 'WHATSAPP_STATUS', handle: '+22891000001' })
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
      .send({ status: 'ELIGIBLE', followers: 4200 })
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
