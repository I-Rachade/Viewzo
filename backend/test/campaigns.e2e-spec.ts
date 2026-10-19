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

interface CampaignView {
  id: string;
  code: string;
  status: string;
  platforms: { network: string; budget: number; creators: number }[];
  estimatedViews: number;
}

interface TaskView {
  id: string;
  network: string;
  contentType: string;
  creatorRatePer1000: number;
  campaign: { hashtag: string };
}

const day = 24 * 3600 * 1000;

describe('Campaigns and tasks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
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

  const basic = () => ({
    title: 'Forfait Nuit',
    objective: 'AWARENESS',
    countries: ['TG'],
    cities: ['Lomé'],
    startsAt: new Date(Date.now() - day).toISOString(),
    endsAt: new Date(Date.now() + 7 * day).toISOString(),
    package: 'BASIC',
    budget: 30_000,
    platforms: [{ network: 'TIKTOK', contentType: 'PROVIDED_ASSETS' }],
    hasAssets: true,
    assetUrls: ['https://cdn.example.com/affiche.png'],
    language: 'Français',
  });

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

    advertiser = await login('+22892000001');
    creator = await login('+22892000002');
    staff = await login('+22892000003');
    await prisma.user.update({
      where: { phone: '+22892000003' },
      data: { role: 'STAFF' },
    });

    // A level 1 creator with an eligible TikTok account and the skills form.
    const c = await prisma.user.findUniqueOrThrow({
      where: { phone: '+22892000002' },
    });
    await prisma.userProfile.create({
      data: { userId: c.id, type: 'CREATOR' },
    });
    await prisma.socialAccount.create({
      data: {
        userId: c.id,
        network: 'TIKTOK',
        handle: '@kossi',
        verificationCode: 'VZ-900001',
        status: 'ELIGIBLE',
        followers: 12_400,
      },
    });
    await prisma.creatorSkills.create({
      data: {
        userId: c.id,
        taskTypes: ['POST_PROVIDED_VISUAL', 'POST_PROVIDED_VIDEO'],
        showsFace: true,
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

  it('greys out platforms in the live quote', async () => {
    const res = await http()
      .get('/campaigns/quote')
      .query({
        package: 'PRO',
        budget: 70_000,
        platforms: 'TIKTOK,WHATSAPP_STATUS,INSTAGRAM',
      })
      .set(auth(advertiser))
      .expect(200);
    const body = res.body as {
      minBudget: number;
      estimatedViews: number;
      options: { network: string; unavailable: unknown }[];
    };
    expect(body.minBudget).toBe(70_000);
    expect(body.estimatedViews).toBe(70_000);
    expect(
      body.options.find((o) => o.network === 'YOUTUBE')!.unavailable,
    ).toEqual({ reason: 'PACKAGE', requiredPackage: 'PREMIUM' });
  });

  it('checks profile, level, budget and content rules', async () => {
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(basic())
      .expect(403);
    await http()
      .post('/me/profiles')
      .set(auth(advertiser))
      .send({ type: 'ADVERTISER' })
      .expect(201);

    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send({ ...basic(), package: 'PRO' })
      .expect(403);
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send({ ...basic(), budget: 20_000 })
      .expect(400);
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send({ ...basic(), hasAssets: false, noAssetsChoice: 'CREATOR_VIDEOS' })
      .expect(400);
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send({
        ...basic(),
        hasAssets: false,
        noAssetsChoice: 'CREATOR_VIDEOS',
        platforms: [{ network: 'WHATSAPP_STATUS', contentType: 'FREE_BRIEF' }],
      })
      .expect(400);
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send({ ...basic(), budget: 120_000 })
      .expect(403);
  });

  it('runs a campaign from moderation to a submitted post', async () => {
    const created = await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(basic())
      .expect(201);
    const campaign = created.body as CampaignView;
    expect(campaign).toMatchObject({
      status: 'PENDING_REVIEW',
      estimatedViews: 30_000,
      platforms: [{ network: 'TIKTOK', budget: 30_000, creators: 0 }],
    });

    let tasks = await http().get('/me/tasks').set(auth(creator)).expect(200);
    expect(tasks.body).toEqual([]);

    await http()
      .post(`/staff/campaigns/${campaign.id}/review`)
      .set(auth(advertiser))
      .send({ status: 'ACTIVE' })
      .expect(403);
    await http()
      .post(`/staff/campaigns/${campaign.id}/review`)
      .set(auth(staff))
      .send({ status: 'ACTIVE' })
      .expect(200);

    // Tasks only show once the budget is in escrow.
    tasks = await http().get('/me/tasks').set(auth(creator)).expect(200);
    expect(tasks.body).toEqual([]);
    const payment = await http()
      .post(`/campaigns/${campaign.id}/pay`)
      .set(auth(advertiser))
      .send({ method: 'MOBILE_MONEY' })
      .expect(200);
    const { reference } = payment.body as { reference: string };
    await http()
      .get(`/payments/${reference}`)
      .set(auth(advertiser))
      .expect(200)
      .expect((res) => expect(res.body).toMatchObject({ status: 'SUCCEEDED' }));

    tasks = await http().get('/me/tasks').set(auth(creator)).expect(200);
    const [task] = tasks.body as TaskView[];
    expect(task).toMatchObject({
      network: 'TIKTOK',
      contentType: 'PROVIDED_ASSETS',
      creatorRatePer1000: 450,
      campaign: { hashtag: `#${campaign.code}` },
    });
    expect(task).not.toHaveProperty('budget');

    await http()
      .post(`/tasks/${task.id}/accept`)
      .set(auth(advertiser))
      .expect(403);
    const accepted = await http()
      .post(`/tasks/${task.id}/accept`)
      .set(auth(creator))
      .expect(201);
    await http()
      .post(`/tasks/${task.id}/accept`)
      .set(auth(creator))
      .expect(409);
    tasks = await http().get('/me/tasks').set(auth(creator)).expect(200);
    expect(tasks.body).toEqual([]);

    const assignmentId = (accepted.body as { id: string }).id;
    await http()
      .post(`/me/assignments/${assignmentId}/submit`)
      .set(auth(creator))
      .send({ postUrl: 'pas un lien' })
      .expect(400);
    const submitted = await http()
      .post(`/me/assignments/${assignmentId}/submit`)
      .set(auth(creator))
      .send({ postUrl: 'https://www.tiktok.com/@kossi/video/1' })
      .expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED' });

    const mine = await http()
      .get(`/me/campaigns/${campaign.id}`)
      .set(auth(advertiser))
      .expect(200);
    expect((mine.body as CampaignView).platforms[0].creators).toBe(1);
    await http()
      .get(`/me/campaigns/${campaign.id}`)
      .set(auth(creator))
      .expect(404);
  });

  it('only offers creation tasks to verified creators with the skill', async () => {
    await prisma.userProfile.update({
      where: {
        userId_type: {
          userId: (
            await prisma.user.findUniqueOrThrow({
              where: { phone: '+22892000001' },
            })
          ).id,
          type: 'ADVERTISER',
        },
      },
      data: { level: 2 },
    });
    const created = await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send({
        ...basic(),
        package: 'PRO',
        budget: 60_000,
        hasAssets: false,
        noAssetsChoice: 'CREATOR_VIDEOS',
        platforms: [
          { network: 'TIKTOK', contentType: 'FACECAM', budget: 35_000 },
          { network: 'INSTAGRAM', contentType: 'FACECAM', budget: 25_000 },
        ],
      })
      .expect(201);
    const campaign = created.body as CampaignView;
    expect(campaign.platforms.map((p) => p.budget)).toEqual([35_000, 25_000]);
    await http()
      .post(`/staff/campaigns/${campaign.id}/review`)
      .set(auth(staff))
      .send({ status: 'ACTIVE' })
      .expect(200);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { fundedAt: new Date() },
    });

    let tasks = await http().get('/me/tasks').set(auth(creator)).expect(200);
    expect(tasks.body).toEqual([]);

    const c = await prisma.user.findUniqueOrThrow({
      where: { phone: '+22892000002' },
    });
    await prisma.userProfile.update({
      where: { userId_type: { userId: c.id, type: 'CREATOR' } },
      data: { level: 2 },
    });
    await prisma.creatorSkills.update({
      where: { userId: c.id },
      data: {
        taskTypes: ['CREATE_ORIGINAL_VIDEO'],
        specialties: ['FACECAM'],
      },
    });
    tasks = await http().get('/me/tasks').set(auth(creator)).expect(200);
    // Only TikTok: the creator has no eligible Instagram account.
    expect((tasks.body as TaskView[]).map((t) => t.network)).toEqual([
      'TIKTOK',
    ]);
    expect((tasks.body as TaskView[])[0].creatorRatePer1000).toBe(585);
  });

  it('rejects a campaign with a reason', async () => {
    const created = await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(basic())
      .expect(201);
    const id = (created.body as CampaignView).id;
    await http()
      .post(`/staff/campaigns/${id}/review`)
      .set(auth(staff))
      .send({ status: 'REJECTED' })
      .expect(400);
    const res = await http()
      .post(`/staff/campaigns/${id}/review`)
      .set(auth(staff))
      .send({ status: 'REJECTED', reason: 'Visuel non conforme' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'REJECTED',
      statusReason: 'Visuel non conforme',
    });
    await http()
      .post(`/staff/campaigns/${id}/review`)
      .set(auth(staff))
      .send({ status: 'ACTIVE' })
      .expect(409);
  });
});
