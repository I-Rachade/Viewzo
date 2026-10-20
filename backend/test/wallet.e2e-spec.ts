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

interface Wallet {
  available: number;
  held: number;
  escrow: number;
  pendingWithdrawals: number;
  withdrawalsOpen: boolean;
  provider: string;
}

const day = 24 * 3600 * 1000;

// Runs with PAYMENT_MODE=local: every Mobile Money payment succeeds at once.
describe('Wallet and escrow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let advertiser: string;
  let creator: string;
  let staff: string;
  let creatorId: string;

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

  async function wallet(token: string) {
    const res = await http().get('/me/wallet').set(auth(token)).expect(200);
    return res.body as Wallet;
  }

  async function createCampaign(budget = 30_000) {
    const res = await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send({
        title: 'Jus Bissap',
        objective: 'SALES',
        countries: ['TG'],
        startsAt: new Date(Date.now() - day).toISOString(),
        endsAt: new Date(Date.now() + 7 * day).toISOString(),
        package: 'BASIC',
        budget,
        platforms: [{ network: 'TIKTOK', contentType: 'PROVIDED_ASSETS' }],
        hasAssets: true,
        assetUrls: ['https://cdn.example.com/affiche.png'],
        language: 'Français',
      })
      .expect(201);
    return (res.body as { id: string }).id;
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

    advertiser = await login('+22893000001');
    creator = await login('+22893000002');
    staff = await login('+22893000003');
    await prisma.user.update({
      where: { phone: '+22893000003' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
    await http()
      .post('/me/profiles')
      .set(auth(advertiser))
      .send({ type: 'ADVERTISER' })
      .expect(201);

    const c = await prisma.user.findUniqueOrThrow({
      where: { phone: '+22893000002' },
    });
    creatorId = c.id;
    await prisma.userProfile.create({
      data: { userId: c.id, type: 'CREATOR' },
    });
    await prisma.socialAccount.create({
      data: {
        userId: c.id,
        network: 'TIKTOK',
        handle: '@ama',
        handleKey: 'ama',
        verificationCode: 'VZ-900101',
        status: 'ELIGIBLE',
        followers: 5_000,
      },
    });
    await prisma.creatorSkills.create({
      data: {
        userId: c.id,
        taskTypes: ['POST_PROVIDED_VIDEO'],
        showsFace: false,
        languages: ['Français'],
        countries: ['TG'],
        themes: ['Food'],
        tasksPerWeek: 5,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('funds a campaign from the wallet after a Mobile Money deposit', async () => {
    const campaignId = await createCampaign();
    await http()
      .post(`/campaigns/${campaignId}/pay`)
      .set(auth(advertiser))
      .send({ method: 'WALLET' })
      .expect(400);

    const deposit = await http()
      .post('/me/wallet/deposits')
      .set(auth(advertiser))
      .send({ amount: 50_000 })
      .expect(201);
    const { reference, checkoutUrl } = deposit.body as {
      reference: string;
      checkoutUrl: string;
    };
    expect(checkoutUrl).toContain(reference);
    // Someone else can't read the payment.
    await http().get(`/payments/${reference}`).set(auth(creator)).expect(404);
    await http()
      .get(`/payments/${reference}`)
      .set(auth(advertiser))
      .expect(200)
      .expect((res) => expect(res.body).toMatchObject({ status: 'SUCCEEDED' }));
    expect(await wallet(advertiser)).toMatchObject({
      available: 50_000,
      provider: 'local',
    });

    await http()
      .post(`/campaigns/${campaignId}/pay`)
      .set(auth(advertiser))
      .send({ method: 'WALLET' })
      .expect(200);
    await http()
      .post(`/campaigns/${campaignId}/pay`)
      .set(auth(advertiser))
      .send({ method: 'WALLET' })
      .expect(409);
    expect(await wallet(advertiser)).toMatchObject({
      available: 20_000,
      escrow: 30_000,
    });
    const mine = await http()
      .get(`/me/campaigns/${campaignId}`)
      .set(auth(advertiser))
      .expect(200);
    expect((mine.body as { fundedAt: string | null }).fundedAt).not.toBeNull();

    // Refusing a funded campaign gives the escrow back.
    await http()
      .post(`/staff/campaigns/${campaignId}/review`)
      .set(auth(staff))
      .send({ status: 'REJECTED', reason: 'Visuel illisible' })
      .expect(200);
    expect(await wallet(advertiser)).toMatchObject({
      available: 50_000,
      escrow: 0,
    });
  });

  it('pays validated views into a held balance and handles withdrawals', async () => {
    const campaignId = await createCampaign(25_000);
    await http()
      .post(`/campaigns/${campaignId}/pay`)
      .set(auth(advertiser))
      .send({ method: 'WALLET' })
      .expect(200);
    await http()
      .post(`/staff/campaigns/${campaignId}/review`)
      .set(auth(staff))
      .send({ status: 'ACTIVE' })
      .expect(200);

    const tasks = await http().get('/me/tasks').set(auth(creator)).expect(200);
    const [task] = tasks.body as { id: string }[];
    const accepted = await http()
      .post(`/tasks/${task.id}/accept`)
      .set(auth(creator))
      .expect(201);
    const assignmentId = (accepted.body as { id: string }).id;

    // No views before the link is submitted.
    await http()
      .post(`/staff/assignments/${assignmentId}/views`)
      .set(auth(staff))
      .send({ totalViews: 1_000 })
      .expect(400);
    await http()
      .post(`/me/assignments/${assignmentId}/submit`)
      .set(auth(creator))
      .send({ postUrl: 'https://www.tiktok.com/@ama/video/7' })
      .expect(200);

    // 30,000 views but the 25,000 FCFA budget pays 25,000; level 1 earnings
    // stop at 10,000 FCFA.
    const recorded = await http()
      .post(`/staff/assignments/${assignmentId}/views`)
      .set(auth(staff))
      .send({ totalViews: 30_000 })
      .expect(200);
    expect(recorded.body).toEqual({
      id: assignmentId,
      validViews: 25_000,
      earned: 10_000,
      unpaidViews: 5_000,
    });
    await http()
      .post(`/staff/assignments/${assignmentId}/views`)
      .set(auth(staff))
      .send({ totalViews: 10 })
      .expect(400);

    // Held until next month.
    expect(await wallet(creator)).toMatchObject({
      available: 0,
      held: 10_000,
      withdrawalsOpen: false,
    });
    expect(await wallet(advertiser)).toMatchObject({ escrow: 0 });

    const withdrawal = {
      amount: 4_000,
      beneficiaryName: 'Ama Mensah',
    };
    await http()
      .post('/me/wallet/withdrawals')
      .set(auth(creator))
      .send(withdrawal)
      .expect(403);

    // Verified, and the hold is over.
    await prisma.userProfile.update({
      where: { userId_type: { userId: creatorId, type: 'CREATOR' } },
      data: { level: 2 },
    });
    await prisma.transaction.updateMany({
      where: { userId: creatorId, type: 'EARNING' },
      data: { availableAt: new Date(Date.now() - day) },
    });
    expect(await wallet(creator)).toMatchObject({
      available: 10_000,
      held: 0,
      withdrawalsOpen: true,
    });

    await http()
      .post('/me/wallet/withdrawals')
      .set(auth(creator))
      .send({ ...withdrawal, amount: 500 })
      .expect(400);
    await http()
      .post('/me/wallet/withdrawals')
      .set(auth(creator))
      .send({ ...withdrawal, amount: 12_000 })
      .expect(400);
    const first = await http()
      .post('/me/wallet/withdrawals')
      .set(auth(creator))
      .send(withdrawal)
      .expect(201);
    expect(first.body).toMatchObject({ status: 'REQUESTED' });
    expect(await wallet(creator)).toMatchObject({
      available: 6_000,
      pendingWithdrawals: 4_000,
    });

    const queue = await http()
      .get('/staff/withdrawals')
      .set(auth(staff))
      .expect(200);
    expect(queue.body).toHaveLength(1);
    await http().get('/staff/withdrawals').set(auth(creator)).expect(403);

    const firstId = (first.body as { id: string }).id;
    await http()
      .post(`/staff/withdrawals/${firstId}/review`)
      .set(auth(staff))
      .send({ decision: 'REJECT', reason: 'Nom différent de la pièce' })
      .expect(200);
    await http()
      .post(`/staff/withdrawals/${firstId}/review`)
      .set(auth(staff))
      .send({ decision: 'APPROVE' })
      .expect(409);
    expect(await wallet(creator)).toMatchObject({ available: 10_000 });

    const second = await http()
      .post('/me/wallet/withdrawals')
      .set(auth(creator))
      .send(withdrawal)
      .expect(201);
    const approved = await http()
      .post(`/staff/withdrawals/${(second.body as { id: string }).id}/review`)
      .set(auth(staff))
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'SUCCEEDED' });
    expect(await wallet(creator)).toMatchObject({
      available: 6_000,
      pendingWithdrawals: 0,
    });

    const history = await http()
      .get('/me/wallet/transactions')
      .set(auth(creator))
      .expect(200);
    expect(
      (history.body as { type: string; status: string }[]).map(
        (t) => `${t.type}:${t.status}`,
      ),
    ).toEqual([
      'WITHDRAWAL:COMPLETED',
      'WITHDRAWAL:CANCELLED',
      'EARNING:COMPLETED',
    ]);
  });

  it('ignores webhooks for unknown payments', async () => {
    await http()
      .post('/payments/webhooks/local')
      .send({ reference: 'VZPUNKNOWN' })
      .expect(200);
    await http().post('/payments/webhooks/nope').send({}).expect(503);
  });
});
