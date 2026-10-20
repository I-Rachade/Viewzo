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

describe('Password auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const codes = new Capture();

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
    await prisma.userProfile.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.user.deleteMany();
    await prisma.countryCounter.deleteMany();
    await prisma.otpChallenge.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // Lets the next code go out without waiting for the one-minute cooldown.
  async function skipCooldown() {
    await prisma.otpChallenge.updateMany({
      data: { createdAt: new Date(Date.now() - 2 * 60_000) },
    });
  }

  async function register(
    identifier: string,
    target: string,
    extra: Record<string, string>,
    status = 201,
  ): Promise<{ accessToken: string; [key: string]: unknown }> {
    await http().post('/auth/register/start').send({ identifier }).expect(200);
    const verified = await http()
      .post('/auth/register/verify')
      .send({ identifier, code: codes.last.get(target) })
      .expect(200);
    const res = await http()
      .post('/auth/register/complete')
      .send({ ticket: (verified.body as { ticket: string }).ticket, ...extra })
      .expect(status);
    return res.body as { accessToken: string; [key: string]: unknown };
  }

  it('signs up with an email, a country and a starting role', async () => {
    const res = await register('Awa@Example.com', 'awa@example.com', {
      password: 'motdepasse1',
      role: 'ADVERTISER',
      country: 'TG',
    });
    expect(res).toMatchObject({
      isNew: true,
      user: {
        email: 'awa@example.com',
        phone: null,
        hasPassword: true,
        country: 'TG',
        priorityRank: 1,
        profiles: [{ type: 'ADVERTISER' }],
      },
    });

    await http()
      .post('/auth/register/start')
      .send({ identifier: 'awa@example.com' })
      .expect(409);
  });

  it('needs a country for an email sign-up', async () => {
    await register(
      'kofi@example.com',
      'kofi@example.com',
      {
        password: 'motdepasse1',
        role: 'CREATOR',
      },
      400,
    );
  });

  it('takes the country from the phone number', async () => {
    const res = await register('+2290197000009', '+2290197000009', {
      password: 'motdepasse1',
      role: 'CREATOR',
    });
    expect(res).toMatchObject({
      user: { country: 'BJ', phone: '+2290197000009', email: null },
    });
  });

  it('rejects a weak password', async () => {
    await skipCooldown();
    await register(
      '+22890000050',
      '+22890000050',
      {
        password: 'motdepasse',
        role: 'CREATOR',
      },
      400,
    );
  });

  it('logs in with email or phone and a password, and locks after 5 misses', async () => {
    await http()
      .post('/auth/login')
      .send({ identifier: 'AWA@example.com', password: 'motdepasse1' })
      .expect(200);
    await http()
      .post('/auth/login')
      .send({ identifier: '+2290197000009', password: 'motdepasse1' })
      .expect(200);
    await http()
      .post('/auth/login')
      .send({ identifier: 'nobody@example.com', password: 'motdepasse1' })
      .expect(401);

    for (let i = 0; i < 5; i++) {
      await http()
        .post('/auth/login')
        .send({ identifier: 'awa@example.com', password: 'mauvais1' })
        .expect(401);
    }
    await http()
      .post('/auth/login')
      .send({ identifier: 'awa@example.com', password: 'motdepasse1' })
      .expect(429);
  });

  it('lets an old code-only account set its password, ending older sessions', async () => {
    const phone = '+22890000060';
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const old = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: codes.last.get(phone) })
      .expect(200);
    const oldToken = (old.body as { accessToken: string }).accessToken;

    const denied = await http()
      .post('/auth/login')
      .send({ identifier: phone, password: 'motdepasse1' })
      .expect(403);
    expect(denied.body).toMatchObject({ code: 'PASSWORD_NOT_SET' });

    await skipCooldown();
    await http()
      .post('/auth/password/forgot')
      .send({ identifier: phone })
      .expect(200);
    await http()
      .post('/auth/password/reset')
      .send({ identifier: phone, code: '000000', password: 'nouveau123' })
      .expect(401);
    const reset = await http()
      .post('/auth/password/reset')
      .send({
        identifier: phone,
        code: codes.last.get(phone),
        password: 'nouveau123',
      })
      .expect(200);

    await http()
      .get('/me')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(401);
    await http()
      .get('/me')
      .set(
        'Authorization',
        `Bearer ${(reset.body as { accessToken: string }).accessToken}`,
      )
      .expect(200);
    await http()
      .post('/auth/login')
      .send({ identifier: phone, password: 'nouveau123' })
      .expect(200);
  });

  it('does not reveal unknown accounts on forgot password', async () => {
    codes.last.delete('ghost@example.com');
    await http()
      .post('/auth/password/forgot')
      .send({ identifier: 'ghost@example.com' })
      .expect(200);
    expect(codes.last.has('ghost@example.com')).toBe(false);
  });

  it('adds a phone to an email account', async () => {
    await skipCooldown();
    const res = await register('ama@example.com', 'ama@example.com', {
      password: 'motdepasse1',
      role: 'CREATOR',
      country: 'TG',
    });
    const token = res.accessToken;

    await http()
      .post('/auth/contact/request')
      .set('Authorization', `Bearer ${token}`)
      .send({ identifier: '+2290197000009' })
      // A Beninese number on a Togolese account (phone-required.e2e covers 409).
      .expect(400);
    await http()
      .post('/auth/contact/request')
      .set('Authorization', `Bearer ${token}`)
      .send({ identifier: '90000070' })
      .expect(200);
    const me = await http()
      .post('/auth/contact/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ identifier: '90000070', code: codes.last.get('+22890000070') })
      .expect(200);
    expect(me.body).toMatchObject({
      email: 'ama@example.com',
      phone: '+22890000070',
    });
  });

  it('does not accept a registration ticket as a session', async () => {
    await skipCooldown();
    await http()
      .post('/auth/register/start')
      .send({ identifier: 'yao@example.com' })
      .expect(200);
    const verified = await http()
      .post('/auth/register/verify')
      .send({
        identifier: 'yao@example.com',
        code: codes.last.get('yao@example.com'),
      })
      .expect(200);
    await http()
      .get('/me')
      .set(
        'Authorization',
        `Bearer ${(verified.body as { ticket: string }).ticket}`,
      )
      .expect(401);
  });
});
