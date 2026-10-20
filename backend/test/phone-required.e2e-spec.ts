import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { Mail, MAIL_SENDER, MailSender } from '../src/mail/mail-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';
import { SMS_SENDER, SmsSender } from '../src/sms/sms-sender';

// Both senders keep the last code per recipient.
class Capture implements SmsSender, MailSender {
  last = new Map<string, string>();
  send(to: string | Mail, message?: string) {
    const [target, text] =
      typeof to === 'string' ? [to, message!] : [to.to, to.text];
    this.last.set(target, text.match(/\d{6}/)![0]);
    return Promise.resolve();
  }
}

const TASK = '00000000-0000-4000-8000-000000000000';

describe('Phone required for creators (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const codes = new Capture();

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(
    email: string,
    role: 'CREATOR' | 'ADVERTISER',
    country = 'TG',
  ) {
    await http()
      .post('/auth/register/start')
      .send({ identifier: email })
      .expect(200);
    const verified = await http()
      .post('/auth/register/verify')
      .send({ identifier: email, code: codes.last.get(email) })
      .expect(200);
    const res = await http()
      .post('/auth/register/complete')
      .send({
        ticket: (verified.body as { ticket: string }).ticket,
        password: 'motdepasse1',
        role,
        country,
      })
      .expect(201);
    return res.body as {
      accessToken: string;
      user: { phoneRequired: boolean };
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue(codes)
      .overrideProvider(MAIL_SENDER)
      .useValue(codes)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.allowedCountry.upsert({
      where: { code: 'RW' },
      create: { code: 'RW', enabled: false },
      update: { enabled: false },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { endsWith: '@phone-required.test' } },
          { phone: { startsWith: '+2289420' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.allowedCountry.deleteMany({ where: { code: 'RW' } });
    await app.close();
  });

  it('blocks a creator signed up by e-mail until a phone is verified', async () => {
    const { accessToken: token, user } = await register(
      'awa@phone-required.test',
      'CREATOR',
    );
    expect(user.phoneRequired).toBe(true);

    // Looking at the campaigns and at one's own tasks stays open.
    await http().get('/me/tasks').set(auth(token)).expect(200);
    await http().get('/me/assignments').set(auth(token)).expect(200);
    await http().get('/me/results').set(auth(token)).expect(200);
    for (const [method, path] of [
      ['post', `/tasks/${TASK}/accept`],
      ['get', '/me/accounts'],
      ['put', '/me/skills'],
      ['get', '/me/connections'],
      ['post', `/me/assignments/${TASK}/submit`],
      ['post', `/me/assignments/${TASK}/proofs`],
      ['post', '/me/wallet/withdrawals'],
    ] as const) {
      const res = await http()[method](path).set(auth(token)).send({});
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'PHONE_REQUIRED' });
    }

    await http()
      .post('/auth/contact/request')
      .set(auth(token))
      .send({ identifier: '+22894200001' })
      .expect(200);
    const me = await http()
      .post('/auth/contact/verify')
      .set(auth(token))
      .send({
        identifier: '+22894200001',
        code: codes.last.get('+22894200001'),
      })
      .expect(200);
    expect(me.body).toMatchObject({
      phone: '+22894200001',
      phoneRequired: false,
    });

    // Past the guard: the task simply does not exist.
    await http().post(`/tasks/${TASK}/accept`).set(auth(token)).expect(404);
    await http().get('/me/accounts').set(auth(token)).expect(200);
  });

  it('reads a local number in the account country', async () => {
    const { accessToken: token } = await register(
      'local@phone-required.test',
      'CREATOR',
    );
    const res = await http()
      .post('/auth/contact/request')
      .set(auth(token))
      .send({ identifier: '94200002' })
      .expect(200);
    expect(res.body).toEqual({ sentTo: '+22894200002' });
  });

  it('refuses a number from another country, before any SMS', async () => {
    const { accessToken: token } = await register(
      'kofi@phone-required.test',
      'CREATOR',
    );
    codes.last.delete('+2290197000001');
    const res = await http()
      .post('/auth/contact/request')
      .set(auth(token))
      .send({ identifier: '+2290197000001' })
      .expect(400);
    expect(res.body).toMatchObject({ code: 'PHONE_COUNTRY_MISMATCH' });
    expect(codes.last.has('+2290197000001')).toBe(false);
  });

  it('refuses a number from a switched-off country, before any SMS', async () => {
    const { accessToken: token } = await register(
      'ines@phone-required.test',
      'CREATOR',
    );
    // The account was opened while Rwanda was open.
    await prisma.user.update({
      where: { email: 'ines@phone-required.test' },
      data: { country: 'RW' },
    });
    const res = await http()
      .post('/auth/contact/request')
      .set(auth(token))
      .send({ identifier: '+250781234567' })
      .expect(400);
    expect(res.body).toMatchObject({ code: 'COUNTRY_NOT_ALLOWED' });
    expect(codes.last.has('+250781234567')).toBe(false);
  });

  it('refuses a number already on another account', async () => {
    const { accessToken: token } = await register(
      'yao@phone-required.test',
      'CREATOR',
    );
    await http()
      .post('/auth/contact/request')
      .set(auth(token))
      .send({ identifier: '+22894200001' })
      .expect(409);
  });

  it('leaves advertisers alone, until they become creators', async () => {
    const { accessToken: token, user } = await register(
      'ama@phone-required.test',
      'ADVERTISER',
    );
    expect(user.phoneRequired).toBe(false);
    await http().get('/me/accounts').set(auth(token)).expect(200);

    const me = await http()
      .post('/me/profiles')
      .set(auth(token))
      .send({ type: 'CREATOR' })
      .expect(201);
    expect(me.body).toMatchObject({ phoneRequired: true });
    await http().get('/me/accounts').set(auth(token)).expect(403);
  });

  it('leaves creators signed up by phone alone', async () => {
    const phone = '+22894200009';
    await http()
      .post('/auth/register/start')
      .send({ identifier: phone })
      .expect(200);
    const verified = await http()
      .post('/auth/register/verify')
      .send({ identifier: phone, code: codes.last.get(phone) })
      .expect(200);
    const res = await http()
      .post('/auth/register/complete')
      .send({
        ticket: (verified.body as { ticket: string }).ticket,
        password: 'motdepasse1',
        role: 'CREATOR',
      })
      .expect(201);
    const body = res.body as {
      accessToken: string;
      user: { phoneRequired: boolean };
    };
    expect(body.user.phoneRequired).toBe(false);
    await http()
      .post(`/tasks/${TASK}/accept`)
      .set(auth(body.accessToken))
      .expect(404);
  });
});
