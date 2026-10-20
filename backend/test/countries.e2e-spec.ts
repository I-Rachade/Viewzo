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

describe('Allowed countries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let admin: string;
  let moderator: string;
  let user: string;
  let moderatorId: string;

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
    await prisma.allowedCountry.deleteMany({ where: { code: 'RW' } });
    await prisma.user.deleteMany({
      where: { phone: { startsWith: '+2289410' } },
    });

    admin = await login('+22894100001');
    moderator = await login('+22894100002');
    user = await login('+22894100003');
    await prisma.user.update({
      where: { phone: '+22894100001' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
    moderatorId = (
      await prisma.user.update({
        where: { phone: '+22894100002' },
        data: { role: 'STAFF', staffRole: 'MODERATOR' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.allowedCountry.deleteMany({ where: { code: 'RW' } });
    await app.close();
  });

  it('lists the enabled countries without login', async () => {
    const res = await http().get('/countries').expect(200);
    expect(res.body).toEqual(expect.arrayContaining(['TG', 'BJ', 'FR']));
    expect(res.body).not.toContain('RW');
  });

  it('lets only super admins change the list', async () => {
    // The journal refuses deletes, so earlier runs stay in it.
    const since = new Date();
    await http().get('/staff/countries').set(auth(user)).expect(403);
    await http().get('/staff/countries').set(auth(moderator)).expect(200);
    await http()
      .post('/staff/countries')
      .set(auth(moderator))
      .send({ code: 'RW' })
      .expect(403);

    const added = await http()
      .post('/staff/countries')
      .set(auth(admin))
      .send({ code: 'rw' })
      .expect(201);
    expect(added.body).toEqual({ code: 'RW', enabled: true });
    expect((await http().get('/countries').expect(200)).body).toContain('RW');

    await http()
      .patch('/staff/countries/RW')
      .set(auth(admin))
      .send({ enabled: false })
      .expect(200);
    expect((await http().get('/countries').expect(200)).body).not.toContain(
      'RW',
    );
    const all = await http()
      .get('/staff/countries')
      .set(auth(admin))
      .expect(200);
    expect(all.body).toContainEqual({ code: 'RW', enabled: false });

    const journal = await prisma.auditLog.findMany({
      where: {
        entity: 'AllowedCountry',
        entityId: 'RW',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(journal.map((j) => j.action)).toEqual([
      'country.add',
      'country.disable',
    ]);
  });

  it('refuses unknown codes', async () => {
    await http()
      .post('/staff/countries')
      .set(auth(admin))
      .send({ code: 'ZZ' })
      .expect(400);
    await http()
      .patch('/staff/countries/ZZ')
      .set(auth(admin))
      .send({ enabled: true })
      .expect(404);
  });
  it('refuses countries that are not open', async () => {
    const closed = { code: 'COUNTRY_NOT_ALLOWED', countries: ['RW'] };
    // A Rwandan number can neither sign up nor get a code-only account.
    const signup = await http()
      .post('/auth/register/start')
      .send({ identifier: '+250788123456' })
      .expect(400);
    expect(signup.body).toMatchObject(closed);
    await http()
      .post('/auth/otp/request')
      .send({ phone: '+250788123456' })
      .expect(200);
    await http()
      .post('/auth/otp/verify')
      .send({ phone: '+250788123456', code: sms.last.get('+250788123456') })
      .expect(400);

    await http()
      .post('/me/profiles')
      .set(auth(user))
      .send({ type: 'CREATOR' })
      .expect(201);
    const skills = await http()
      .put('/me/skills')
      .set(auth(user))
      .send({
        taskTypes: ['POST_PROVIDED_VIDEO'],
        showsFace: true,
        languages: ['Français'],
        countries: ['TG', 'RW'],
        themes: ['food'],
        tasksPerWeek: 2,
      })
      .expect(400);
    expect(skills.body).toMatchObject(closed);

    await http()
      .post('/me/profiles')
      .set(auth(user))
      .send({ type: 'ADVERTISER' })
      .expect(201);
    const campaign = await http()
      .post('/campaigns')
      .set(auth(user))
      .send({
        title: 'Hors zone',
        objective: 'AWARENESS',
        countries: ['RW'],
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        package: 'BASIC',
        budget: 30_000,
        platforms: [{ network: 'TIKTOK', contentType: 'PROVIDED_ASSETS' }],
        hasAssets: true,
        assetUrls: ['https://cdn.example.com/affiche.png'],
        language: 'Français',
      })
      .expect(400);
    expect(campaign.body).toMatchObject(closed);

    const member = await http()
      .patch(`/staff/members/${moderatorId}`)
      .set(auth(admin))
      .send({ staffRole: 'COUNTRY_MANAGER', countries: ['RW'] })
      .expect(400);
    expect(member.body).toMatchObject(closed);
  });
});
