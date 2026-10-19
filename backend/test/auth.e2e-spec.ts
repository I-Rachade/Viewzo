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

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.userProfile.deleteMany();
    await prisma.user.deleteMany();
    await prisma.countryCounter.deleteMany();
    await prisma.otpChallenge.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(phone: string) {
    const req = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ phone })
      .expect(200);
    const e164 = (req.body as { phone: string }).phone;
    const res = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ phone, code: sms.last.get(e164) })
      .expect(200);
    return res.body as {
      accessToken: string;
      isNew: boolean;
      user: { priorityRank: number; isFounder: boolean; country: string };
    };
  }

  it('signs up, assigns per-country ranks and activates a profile', async () => {
    const first = await login('+22890000001');
    expect(first.isNew).toBe(true);
    expect(first.user).toMatchObject({
      country: 'TG',
      priorityRank: 1,
      isFounder: true,
    });

    const second = await login('+22890000002');
    expect(second.user.priorityRank).toBe(2);

    const benin = await login('+2290197000001');
    expect(benin.user).toMatchObject({ country: 'BJ', priorityRank: 1 });

    const res = await request(app.getHttpServer())
      .post('/me/profiles')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({ type: 'CREATOR' })
      .expect(201);
    expect((res.body as { profiles: unknown[] }).profiles).toEqual([
      { type: 'CREATOR', level: 1 },
    ]);
  });

  it('keeps the rank when the same phone logs in again', async () => {
    await prisma.otpChallenge.deleteMany();
    const again = await login('+22890000001');
    expect(again.isNew).toBe(false);
    expect(again.user.priorityRank).toBe(1);
  });

  it('rejects a wrong code', async () => {
    await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ phone: '+22890000009' })
      .expect(200);
    const sent = sms.last.get('+22890000009');
    const wrong = sent === '000000' ? '111111' : '000000';
    await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ phone: '+22890000009', code: wrong })
      .expect(401);
  });

  it('requires a token for /me', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
  });
});
