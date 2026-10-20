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

const day = 24 * 3600 * 1000;

interface Session {
  accessToken: string;
  refreshToken?: string;
}

describe('Sessions, roles and money safety (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let admin: string;
  let finance: string;
  let financeTg: string;
  let creator: string;
  let creatorId: string;
  let adminId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(phone: string, web = false) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const req = http().post('/auth/otp/verify');
    if (web) void req.set('X-Viewzo-Client', 'web');
    return req.send({ phone, code: sms.last.get(phone) }).expect(200);
  }

  async function staffMember(
    phone: string,
    staffRole: string,
    staffCountries: string[] = [],
  ) {
    const res = await login(phone);
    const user = await prisma.user.update({
      where: { phone },
      data: { role: 'STAFF', staffRole: staffRole as never, staffCountries },
    });
    return { token: (res.body as Session).accessToken, id: user.id };
  }

  async function withdrawal(amount: number, userId = creatorId) {
    const payment = await prisma.payment.create({
      data: {
        userId,
        kind: 'PAYOUT',
        provider: 'local',
        reference: `R-${Math.random().toString(36).slice(2)}`,
        amount,
        phone: '+22895000004',
        beneficiaryName: 'Ama',
        status: 'REQUESTED',
      },
    });
    await prisma.transaction.create({
      data: {
        userId,
        type: 'WITHDRAWAL',
        amount: -amount,
        status: 'PENDING',
        paymentId: payment.id,
      },
    });
    return payment.id;
  }

  beforeAll(async () => {
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

    ({ token: admin, id: adminId } = await staffMember(
      '+22895000001',
      'SUPER_ADMIN',
    ));
    ({ token: finance } = await staffMember('+22895000002', 'FINANCE'));
    ({ token: financeTg } = await staffMember('+22895000003', 'FINANCE', [
      'TG',
    ]));
    creator = ((await login('+22895000004')).body as Session).accessToken;
    creatorId = (
      await prisma.user.findUniqueOrThrow({ where: { phone: '+22895000004' } })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sessions', () => {
    it('rotates the refresh token and ends the session when an old one is reused', async () => {
      const first = (await login('+22895000010')).body as Session;
      expect(first.refreshToken).toBeDefined();
      const next = (
        await http()
          .post('/auth/refresh')
          .send({ refreshToken: first.refreshToken })
          .expect(200)
      ).body as Session;
      expect(next.refreshToken).not.toEqual(first.refreshToken);
      await http().get('/me').set(auth(next.accessToken)).expect(200);

      // The old token again: someone copied it, so the session ends for both.
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      await http().get('/me').set(auth(next.accessToken)).expect(401);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: next.refreshToken })
        .expect(401);
    });

    it('ends the session on logout', async () => {
      const s = (await login('+22895000011')).body as Session;
      await http()
        .post('/auth/logout')
        .send({ refreshToken: s.refreshToken })
        .expect(204);
      await http().get('/me').set(auth(s.accessToken)).expect(401);
    });

    it('keeps the web refresh token in an httpOnly cookie', async () => {
      const res = await login('+22895000012', true);
      expect((res.body as Session).refreshToken).toBeUndefined();
      const cookie = ([] as string[])
        .concat(res.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith('vz_refresh='))!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/auth/i);
      const refreshed = await http()
        .post('/auth/refresh')
        .set('X-Viewzo-Client', 'web')
        .set('Cookie', cookie.split(';')[0])
        .expect(200);
      expect((refreshed.body as Session).accessToken).toBeDefined();
      expect((refreshed.body as Session).refreshToken).toBeUndefined();
    });

    it('accepts one correct code once, even sent in parallel', async () => {
      const phone = '+22895000013';
      await http().post('/auth/otp/request').send({ phone }).expect(200);
      const code = sms.last.get(phone);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          http().post('/auth/otp/verify').send({ phone, code }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it('refuses a code login on an account protected by a password', async () => {
      const phone = '+22895000014';
      await prisma.user.create({
        data: { phone, country: 'TG', priorityRank: 900, passwordHash: 'set' },
      });
      await http().post('/auth/otp/request').send({ phone }).expect(200);
      const res = await http()
        .post('/auth/otp/verify')
        .send({ phone, code: sms.last.get(phone) })
        .expect(403);
      expect(res.body).toMatchObject({ code: 'PASSWORD_LOGIN_REQUIRED' });
    });
  });

  describe('withdrawals', () => {
    it('needs two different finance members for a large withdrawal', async () => {
      const id = await withdrawal(150_000);
      const first = await http()
        .post(`/staff/withdrawals/${id}/review`)
        .set(auth(finance))
        .send({ decision: 'APPROVE' })
        .expect(200);
      expect(first.body).toMatchObject({
        status: 'REQUESTED',
        awaitingSecondApproval: true,
      });
      await http()
        .post(`/staff/withdrawals/${id}/review`)
        .set(auth(finance))
        .send({ decision: 'APPROVE' })
        .expect(409);
      await http()
        .post(`/staff/withdrawals/${id}/review`)
        .set(auth(admin))
        .send({ decision: 'APPROVE' })
        .expect(200);
      const actions = await prisma.auditLog.findMany({
        where: { entityId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'WITHDRAWAL_FIRST_APPROVAL',
          'WITHDRAWAL_APPROVE',
        ]),
      );
    });

    it('pays a small withdrawal only once when approved twice at the same time', async () => {
      const id = await withdrawal(5_000);
      const results = await Promise.all([
        http()
          .post(`/staff/withdrawals/${id}/review`)
          .set(auth(finance))
          .send({ decision: 'APPROVE' }),
        http()
          .post(`/staff/withdrawals/${id}/review`)
          .set(auth(admin))
          .send({ decision: 'APPROVE' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('keeps finance members to their countries and off their own money', async () => {
      // The country is the account's, not the payout number's.
      const beninUser = await prisma.user.create({
        data: { phone: '+2290197000004', country: 'BJ', priorityRank: 901 },
      });
      const benin = await withdrawal(5_000, beninUser.id);
      await http()
        .post(`/staff/withdrawals/${benin}/review`)
        .set(auth(financeTg))
        .send({ decision: 'APPROVE' })
        .expect(403);
      const queue = await http()
        .get('/staff/withdrawals')
        .set(auth(financeTg))
        .expect(200);
      expect((queue.body as { id: string }[]).some((p) => p.id === benin)).toBe(
        false,
      );

      const own = await prisma.payment.create({
        data: {
          userId: adminId,
          kind: 'PAYOUT',
          provider: 'local',
          reference: 'R-own',
          amount: 5_000,
          phone: '+22895000001',
          status: 'REQUESTED',
        },
      });
      await http()
        .post(`/staff/withdrawals/${own.id}/review`)
        .set(auth(admin))
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('keeps people outside finance away from withdrawals', async () => {
      await http().get('/staff/withdrawals').set(auth(creator)).expect(403);
      const { token } = await staffMember('+22895000020', 'MODERATOR');
      await http().get('/staff/withdrawals').set(auth(token)).expect(403);
    });
  });

  describe('campaigns and journal', () => {
    it('refunds a rejected campaign once, even when rejected twice at the same time', async () => {
      const campaign = await prisma.campaign.create({
        data: {
          advertiserId: creatorId,
          code: 'VZ9901',
          title: 'Double',
          objective: 'SALES',
          countries: ['TG'],
          startsAt: new Date(),
          endsAt: new Date(Date.now() + day),
          package: 'BASIC',
          budget: 20_000,
          hasAssets: true,
          language: 'Français',
          fundedAt: new Date(),
        },
      });
      const reject = (token: string) =>
        http()
          .post(`/staff/campaigns/${campaign.id}/review`)
          .set(auth(token))
          .send({ status: 'REJECTED', reason: 'Visuels manquants' });
      const { token: moderator } = await staffMember(
        '+22895000021',
        'MODERATOR',
      );
      const results = await Promise.all([reject(admin), reject(moderator)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const refunds = await prisma.transaction.findMany({
        where: { campaignId: campaign.id, type: 'REFUND' },
      });
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amount).toBe(20_000);
    });

    it('never lets the journal be changed or erased', async () => {
      const entry = await prisma.auditLog.findFirstOrThrow();
      await expect(
        prisma.auditLog.update({
          where: { id: entry.id },
          data: { reason: 'changed' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.auditLog.delete({ where: { id: entry.id } }),
      ).rejects.toThrow();
      const journal = await http()
        .get('/staff/audit')
        .set(auth(admin))
        .expect(200);
      expect((journal.body as unknown[]).length).toBeGreaterThan(0);
      await http().get('/staff/audit').set(auth(finance)).expect(403);
    });
  });
});
