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

interface Lead {
  id: string;
  code: string;
  tiktokUser: string;
  intent: string;
  items: { name: string; quantity: number; unitPrice: number | null }[];
  total: number | null;
  status: string;
  phoneSeen: boolean;
}

interface Board {
  live: { status: string; sourceState: string };
  stats: { comments: number; interested: number; forecast: number };
  leads: Lead[];
  comments: { tiktokUser: string; text: string; intent: string | null }[];
  products: { name: string; left: number | null }[];
  running: boolean;
  ai: boolean;
}

describe('Vente en live TikTok (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let admin: string;
  let moderator: string;
  let seller: string;
  let other: string;
  let sellerId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const setModule = (enabled: boolean) =>
    prisma.platformModule.upsert({
      where: { key: 'LIVE_SALES' },
      create: { key: 'LIVE_SALES', enabled },
      update: { enabled },
    });

  async function login(phone: string) {
    await http().post('/auth/otp/request').send({ phone }).expect(200);
    const res = await http()
      .post('/auth/otp/verify')
      .send({ phone, code: sms.last.get(phone) })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  async function board(id: string) {
    const res = await http()
      .get(`/me/live/sales/${id}`)
      .set(auth(seller))
      .expect(200);
    return res.body as Board;
  }

  beforeAll(async () => {
    process.env.LIVE_DEMO_INTERVAL_MS = '5';
    delete process.env.ANTHROPIC_API_KEY;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({
      where: { phone: { startsWith: '+2289420' } },
    });
    await prisma.platformModule.deleteMany({ where: { key: 'LIVE_SALES' } });

    admin = await login('+22894200001');
    moderator = await login('+22894200002');
    seller = await login('+22894200003');
    other = await login('+22894200004');
    await prisma.user.update({
      where: { phone: '+22894200001' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
    await prisma.user.update({
      where: { phone: '+22894200002' },
      data: { role: 'STAFF', staffRole: 'MODERATOR' },
    });
    sellerId = (
      await prisma.user.findUniqueOrThrow({
        where: { phone: '+22894200003' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.platformModule.deleteMany({ where: { key: 'LIVE_SALES' } });
    await app.close();
  });

  it('hides the module until a super admin switches it on', async () => {
    await http().get('/me/live/products').set(auth(seller)).expect(404);
    await http().get('/staff/live/sales').set(auth(admin)).expect(404);
    let res = await http().get('/modules').expect(200);
    expect(res.body).not.toContain('LIVE_SALES');

    res = await http().get('/staff/modules').set(auth(moderator)).expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({ key: 'LIVE_SALES', enabled: false }),
    ]);
    await http()
      .patch('/staff/modules/LIVE_SALES')
      .set(auth(moderator))
      .send({ enabled: true })
      .expect(403);
    await http()
      .patch('/staff/modules/LIVE_SALES')
      .set(auth(seller))
      .send({ enabled: true })
      .expect(403);
    await http()
      .patch('/staff/modules/NOPE')
      .set(auth(admin))
      .send({ enabled: true })
      .expect(404);
    await http()
      .patch('/staff/modules/LIVE_SALES')
      .set(auth(admin))
      .send({ enabled: true })
      .expect(200, { key: 'LIVE_SALES', enabled: true });

    res = await http().get('/modules').expect(200);
    expect(res.body).toContain('LIVE_SALES');
    const logged = await prisma.auditLog.findFirst({
      where: { action: 'module.enable', entityId: 'LIVE_SALES' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logged).not.toBeNull();
    await http().get('/me/live/products').set(auth(seller)).expect(200, []);
  });

  let pagne: string;
  let sac: string;

  it('needs the advertiser profile, and keeps catalogues apart', async () => {
    await http()
      .post('/me/live/products')
      .set(auth(seller))
      .send({ name: 'Pagne wax', price: 5000, stock: 3 })
      .expect(403);
    await prisma.userProfile.create({
      data: { userId: sellerId, type: 'ADVERTISER' },
    });
    let res = await http()
      .post('/me/live/products')
      .set(auth(seller))
      .send({ name: 'Pagne wax', price: 5000, stock: 3 })
      .expect(201);
    pagne = (res.body as { id: string }).id;
    res = await http()
      .post('/me/live/products')
      .set(auth(seller))
      .send({ name: 'Sac noir', price: 12000 })
      .expect(201);
    sac = (res.body as { id: string }).id;
    await http()
      .post('/me/live/products')
      .set(auth(seller))
      .send({ name: 'Savon', price: -1 })
      .expect(400);

    await http()
      .patch(`/me/live/products/${pagne}`)
      .set(auth(other))
      .send({ price: 1 })
      .expect(404);
    res = await http()
      .patch(`/me/live/products/${sac}`)
      .set(auth(seller))
      .send({ stock: null, price: 11000 })
      .expect(200);
    expect(res.body).toMatchObject({ price: 11000, stock: null });
  });

  let liveId: string;

  it('reads a demo live and turns buyers into carts with a code', async () => {
    let res = await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Live du soir',
        tiktokUsername: '@boutique.ama',
        scheduledAt: new Date().toISOString(),
        demo: true,
        productIds: [pagne, sac],
      })
      .expect(201);
    liveId = (res.body as { id: string }).id;
    expect(res.body).toMatchObject({
      status: 'SCHEDULED',
      tiktokUsername: 'boutique.ama',
    });
    await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Live',
        tiktokUsername: 'x',
        scheduledAt: new Date().toISOString(),
      })
      .expect(400);
    await http().get(`/me/live/sales/${liveId}`).set(auth(other)).expect(404);

    res = await http()
      .post(`/me/live/sales/${liveId}/start`)
      .set(auth(seller))
      .expect(200);
    expect(res.body).toMatchObject({ status: 'RUNNING', running: true });

    let b = await board(liveId);
    for (let i = 0; i < 100 && b.stats.comments < 16; i++) {
      await new Promise((r) => setTimeout(r, 30));
      b = await board(liveId);
    }
    expect(b.stats.comments).toBe(16);
    expect(b.ai).toBe(false);

    // Stop flushes the comments still being classified.
    res = await http()
      .post(`/me/live/sales/${liveId}/stop`)
      .set(auth(seller))
      .expect(200);
    expect(res.body).toMatchObject({ status: 'ENDED' });
    b = await board(liveId);
    expect(b.running).toBe(false);

    const byUser = new Map(b.leads.map((l) => [l.tiktokUser, l]));
    expect(byUser.get('edem228')).toMatchObject({
      intent: 'achat',
      items: [{ name: 'Pagne wax', quantity: 2, unitPrice: 5000 }],
      total: 10000,
      status: 'NEW',
    });
    expect(byUser.get('kossi.tg')).toMatchObject({ intent: 'question_prix' });
    expect(byUser.has('afi_b')).toBe(false);
    for (const l of b.leads) expect(l.code).toMatch(/^VZ[2-9A-HJ-NP-Z]{4}$/);

    // The number written in a comment is masked, never stored.
    expect(byUser.get('kafui')).toMatchObject({ phoneSeen: true });
    const kafui = b.comments.find((c) => c.tiktokUser === 'kafui')!;
    expect(kafui.text).toBe('Je prends 1 pagne, mon WhatsApp [numéro masqué]');
    const stored = await prisma.liveComment.findMany({
      where: { liveId, text: { contains: '90 12' } },
    });
    expect(stored).toHaveLength(0);

    // 2 + 1 pagnes promised out of 3.
    expect(b.products.find((p) => p.name === 'Pagne wax')!.left).toBe(0);

    await http()
      .post(`/me/live/sales/${liveId}/start`)
      .set(auth(seller))
      .expect(409);
  });

  it('lets the seller add a customer by hand and follow the order', async () => {
    let res = await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Live manuel',
        tiktokUsername: 'boutique.ama',
        scheduledAt: new Date().toISOString(),
        demo: true,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await http()
      .post(`/me/live/sales/${id}/leads`)
      .set(auth(seller))
      .send({ tiktokUser: 'yawa' })
      .expect(409);
    await http()
      .post(`/me/live/sales/${id}/start`)
      .set(auth(seller))
      .expect(200);
    res = await http()
      .post(`/me/live/sales/${id}/leads`)
      .set(auth(seller))
      .send({
        tiktokUser: '@yawa',
        items: [{ productId: sac, quantity: 2, variant: 'grand' }],
      })
      .expect(201);
    const lead = res.body as Lead;
    expect(lead).toMatchObject({ tiktokUser: 'yawa', total: 22000 });
    await http()
      .post(`/me/live/sales/${id}/leads`)
      .set(auth(seller))
      .send({ tiktokUser: 'yawa' })
      .expect(409);
    res = await http()
      .patch(`/me/live/sales/${id}/leads/${lead.id}`)
      .set(auth(seller))
      .send({ status: 'PAID' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'PAID' });
    await http()
      .patch(`/me/live/sales/${id}/leads/${lead.id}`)
      .set(auth(other))
      .send({ status: 'CANCELLED' })
      .expect(404);
    await http()
      .post(`/me/live/sales/${id}/stop`)
      .set(auth(seller))
      .expect(200);
  });

  it('lets the team see lives and stop one', async () => {
    let res = await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Live suspect',
        tiktokUsername: 'boutique.ama',
        scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      .expect(201);
    const id = (res.body as { id: string }).id;

    res = await http()
      .get('/staff/live/sales?status=SCHEDULED')
      .set(auth(moderator))
      .expect(200);
    expect((res.body as { id: string }[]).map((l) => l.id)).toContain(id);
    await http()
      .get('/staff/live/sales?status=NOPE')
      .set(auth(moderator))
      .expect(400);
    await http().get('/staff/live/sales').set(auth(seller)).expect(403);

    await http()
      .post(`/staff/live/sales/${liveId}/cancel`)
      .set(auth(moderator))
      .send({ reason: 'Plainte' })
      .expect(409);
    res = await http()
      .post(`/staff/live/sales/${id}/cancel`)
      .set(auth(moderator))
      .send({ reason: 'Plainte de clients' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Plainte de clients',
    });
    await http()
      .post(`/me/live/sales/${id}/start`)
      .set(auth(seller))
      .expect(409);
  });

  it('hides everything again once switched off', async () => {
    await setModule(false);
    await http().get('/me/live/sales').set(auth(seller)).expect(404);
    await http().get('/staff/live/sales').set(auth(admin)).expect(404);
    const res = await http().get('/modules').expect(200);
    expect(res.body).not.toContain('LIVE_SALES');
  });
});
