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

describe('Back-office (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let staff: string;
  let user: string;

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

    staff = await login('+22894000001');
    user = await login('+22894000002');
    await prisma.user.update({
      where: { phone: '+22894000001' },
      data: { role: 'STAFF' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('tells the web who is staff', async () => {
    const me = await http().get('/me').set(auth(staff)).expect(200);
    expect(me.body).toMatchObject({ isStaff: true });
    const other = await http().get('/me').set(auth(user)).expect(200);
    expect(other.body).toMatchObject({ isStaff: false });
  });

  it('counts what waits for the team and lists posts to count', async () => {
    await http().get('/staff/overview').set(auth(user)).expect(403);
    expect(
      (await http().get('/staff/overview').set(auth(staff)).expect(200)).body,
    ).toEqual({
      accounts: 0,
      campaigns: 0,
      withdrawals: 0,
      assignments: 0,
      alerts: 0,
    });

    const creator = await prisma.user.findUniqueOrThrow({
      where: { phone: '+22894000002' },
    });
    const campaign = await prisma.campaign.create({
      data: {
        advertiserId: (
          await prisma.user.findUniqueOrThrow({
            where: { phone: '+22894000001' },
          })
        ).id,
        code: 'VZ0001',
        title: 'Jus Bissap',
        objective: 'SALES',
        countries: ['TG'],
        startsAt: new Date(Date.now() - day),
        endsAt: new Date(Date.now() + day),
        package: 'BASIC',
        budget: 20_000,
        hasAssets: true,
        language: 'Français',
        status: 'ACTIVE',
        fundedAt: new Date(),
        tasks: {
          create: {
            network: 'TIKTOK',
            contentType: 'PROVIDED_ASSETS',
            budget: 20_000,
            position: 0,
            creatorRatePer1000: 400,
          },
        },
      },
      include: { tasks: true },
    });
    await prisma.taskAssignment.create({
      data: {
        taskId: campaign.tasks[0].id,
        creatorId: creator.id,
        status: 'SUBMITTED',
        postUrl: 'https://www.tiktok.com/@ama/video/1',
        submittedAt: new Date(),
      },
    });
    await prisma.socialAccount.create({
      data: {
        userId: creator.id,
        network: 'TIKTOK',
        handle: '@ama',
        verificationCode: 'VZ-800001',
      },
    });

    expect(
      (await http().get('/staff/overview').set(auth(staff)).expect(200)).body,
    ).toEqual({
      accounts: 1,
      campaigns: 0,
      withdrawals: 0,
      assignments: 1,
      alerts: 0,
    });
    const list = await http()
      .get('/staff/assignments')
      .set(auth(staff))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect((list.body as unknown[])[0]).toMatchObject({
      postUrl: 'https://www.tiktok.com/@ama/video/1',
      network: 'TIKTOK',
      validViews: 0,
      campaign: { code: 'VZ0001', title: 'Jus Bissap' },
      creator: { phone: '+22894000002', country: 'TG' },
    });
  });

  it('adds and removes team members', async () => {
    await http()
      .post('/staff/members')
      .set(auth(staff))
      .send({ phone: '+22894000099' })
      .expect(404);
    const added = await http()
      .post('/staff/members')
      .set(auth(staff))
      .send({ phone: '94 00 00 02' })
      .expect(201);
    expect(added.body).toMatchObject({ phone: '+22894000002' });
    await http().get('/staff/overview').set(auth(user)).expect(200);

    const members = await http()
      .get('/staff/members')
      .set(auth(staff))
      .expect(200);
    expect(members.body).toHaveLength(2);
    const self = (members.body as { id: string; phone: string }[]).find(
      (m) => m.phone === '+22894000001',
    )!;
    await http()
      .delete(`/staff/members/${self.id}`)
      .set(auth(staff))
      .expect(400);
    await http()
      .delete(`/staff/members/${(added.body as { id: string }).id}`)
      .set(auth(staff))
      .expect(204);
    await http().get('/staff/overview').set(auth(user)).expect(403);
  });
});
