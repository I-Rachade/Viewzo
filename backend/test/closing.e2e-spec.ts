import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';
import { SMS_SENDER, SmsSender } from '../src/sms/sms-sender';
import { WalletService } from '../src/wallet/wallet.service';

class CapturingSmsSender implements SmsSender {
  last = new Map<string, string>();
  send(phone: string, message: string) {
    this.last.set(phone, message.match(/\d{6}/)![0]);
    return Promise.resolve();
  }
}

const hour = 3600 * 1000;
const day = 24 * hour;

// Runs with PAYMENT_MODE=local: every Mobile Money payment succeeds at once.
describe('Campaign closing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let wallet: WalletService;
  const sms = new CapturingSmsSender();
  let advertiser: string;
  let creator: string;
  let staff: string;

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

  const available = async () =>
    (
      (await http().get('/me/wallet').set(auth(advertiser)).expect(200))
        .body as { available: number }
    ).available;

  // A funded, active campaign whose only task the creator has submitted.
  async function submittedCampaign(budget: number) {
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
        contentCase: 'READY',
        assetUrls: ['https://cdn.example.com/affiche.png'],
        language: 'Français',
        keyMessage: 'Le bissap qui rafraîchit',
      })
      .expect(201);
    const campaignId = (res.body as { id: string }).id;
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
    await http()
      .post(`/me/assignments/${assignmentId}/submit`)
      .set(auth(creator))
      .send({ postUrl: `https://www.tiktok.com/@ama/video/${assignmentId}` })
      .expect(200);
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    return { campaignId, assignmentId, endsAt: campaign.endsAt };
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
    wallet = app.get(WalletService);
    await prisma.transaction.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.user.deleteMany();
    await prisma.countryCounter.deleteMany();
    await prisma.otpChallenge.deleteMany();

    advertiser = await login('+22896000001');
    creator = await login('+22896000002');
    staff = await login('+22896000003');
    await prisma.user.update({
      where: { phone: '+22896000003' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
    await http()
      .post('/me/profiles')
      .set(auth(advertiser))
      .send({ type: 'ADVERTISER' })
      .expect(201);
    const deposit = await http()
      .post('/me/wallet/deposits')
      .set(auth(advertiser))
      .send({ amount: 100_000 })
      .expect(201);
    // Reading the payment confirms it with the local provider.
    await http()
      .get(`/payments/${(deposit.body as { reference: string }).reference}`)
      .set(auth(advertiser))
      .expect(200);

    const c = await prisma.user.findUniqueOrThrow({
      where: { phone: '+22896000002' },
    });
    await prisma.userProfile.create({
      data: { userId: c.id, type: 'CREATOR' },
    });
    await prisma.socialAccount.create({
      data: {
        userId: c.id,
        network: 'TIKTOK',
        handle: '@ama',
        handleKey: 'ama',
        verificationCode: 'VZ-900102',
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

  it('closes 48 h after the end and gives the unspent budget back', async () => {
    const { campaignId, assignmentId, endsAt } =
      await submittedCampaign(30_000);
    await http()
      .post(`/staff/assignments/${assignmentId}/views`)
      .set(auth(staff))
      .send({ totalViews: 10_000 })
      .expect(200);
    const before = await available();

    expect(await wallet.closeDueCampaigns()).toBe(0);
    expect(
      await wallet.closeDueCampaigns(new Date(endsAt.getTime() + 47 * hour)),
    ).toBe(0);
    const closedAt = new Date(endsAt.getTime() + 49 * hour);
    expect(await wallet.closeDueCampaigns(closedAt)).toBe(1);
    // Closing twice changes nothing.
    expect(await wallet.closeDueCampaigns(closedAt)).toBe(0);

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    expect(campaign).toMatchObject({
      status: 'COMPLETED',
      completedAt: closedAt,
      spent: 10_000,
      refunded: 20_000,
    });
    expect(await available()).toBe(before + 20_000);

    const report = await http()
      .get(`/me/campaigns/${campaignId}`)
      .set(auth(advertiser))
      .expect(200);
    expect(report.body).toMatchObject({ refunded: 20_000 });
    const bell = await prisma.notification.findMany({
      where: { type: 'CAMPAIGN_COMPLETED' },
    });
    expect(bell).toHaveLength(1);
    expect(bell[0].link).toBe(`/campaigns/${campaignId}`);
    const journal = await prisma.auditLog.findMany({
      where: { entity: 'Campaign', entityId: campaignId },
    });
    expect(journal.map((j) => j.action)).toContain('campaign.complete');

    // No more views on a closed campaign.
    await http()
      .post(`/staff/assignments/${assignmentId}/views`)
      .set(auth(staff))
      .send({ totalViews: 12_000 })
      .expect(400);

    // A post refused after closing: its cost goes back to the advertiser.
    await http()
      .post(`/staff/posts/${assignmentId}/review`)
      .set(auth(staff))
      .send({ decision: 'REJECT', reason: 'Vues achetées' })
      .expect(200);
    expect(
      await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ).toMatchObject({ spent: 0, refunded: 30_000 });
    expect(await available()).toBe(before + 30_000);
  });

  it('waits for the team to decide on every post', async () => {
    const { campaignId, assignmentId, endsAt } =
      await submittedCampaign(25_000);
    const before = await available();
    const late = new Date(endsAt.getTime() + 72 * hour);

    expect(await wallet.closeDueCampaigns(late)).toBe(0);
    expect(
      await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ).toMatchObject({ status: 'ACTIVE', refunded: 0 });

    await http()
      .post(`/staff/posts/${assignmentId}/review`)
      .set(auth(staff))
      .send({ decision: 'REJECT', reason: 'Lien introuvable' })
      .expect(200);
    expect(await wallet.closeDueCampaigns(late)).toBe(1);
    expect(
      await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ).toMatchObject({ status: 'COMPLETED', spent: 0, refunded: 25_000 });
    expect(await available()).toBe(before + 25_000);
  });
});
