import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { LiveOffersService } from '../src/live/live-offers.service';
import { LiveRunnerService } from '../src/live/live-runner.service';
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
  reply: string | null;
  whatsappLink: string | null;
  code: string;
  tiktokUser: string;
  intent: string;
  items: { name: string; quantity: number; unitPrice: number | null }[];
  total: number | null;
  status: string;
  phoneSeen: boolean;
}

interface Session {
  id: string;
  status: string;
  tiktokUsername: string;
  payout: string;
  earned: number;
  cost: number;
  flag: string | null;
  payoutReason: string | null;
  running?: boolean;
}

interface CreatorHome {
  eligibility: {
    eligible: boolean;
    reason: string | null;
    tiktok: { username: string; followers: number } | null;
  };
  offers: { id: string; placesLeft: number; maxEarning: number }[];
  sessions: { id: string; status: string; offer: { id: string } }[];
}

interface Board {
  live: {
    status: string;
    mode: string;
    whatsapp: string | null;
    spent: number;
    refunded: number;
  };
  sessions: Session[];
  stats: { comments: number; interested: number; forecast: number };
  leads: Lead[];
  comments: { tiktokUser: string; text: string; intent: string | null }[];
  products: { name: string; left: number | null }[];
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

  const deposit = (userId: string, amount: number) =>
    prisma.transaction.create({
      data: { userId, type: 'DEPOSIT', amount, note: 'test' },
    });
  // Real TikTok lives cannot be reached from the tests: the reading fails to
  // connect, the session still counts as started.
  const noTikTok = () =>
    jest
      .spyOn(app.get(LiveRunnerService), 'start')
      .mockResolvedValueOnce(false);

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
    await prisma.otpChallenge.deleteMany({
      where: { target: { startsWith: '+2289420' } },
    });
    await prisma.transaction.deleteMany({
      where: { user: { phone: { startsWith: '+2289420' } } },
    });
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
    const off = await http()
      .get('/me/live/products')
      .set(auth(seller))
      .expect(404);
    expect((off.body as { code: string }).code).toBe('MODULE_OFF');
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

  const WHATSAPP = '+228 90 00 00 01';
  // French numbers use narrow no-break spaces.
  const text = (s: string | null) => (s ?? '').replace(/\s/g, ' ');
  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);

  let liveId: string;

  it('reads the advertiser’s own demo live and sends buyers to WhatsApp', async () => {
    let res = await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Live du soir',
        mode: 'SELF',
        whatsapp: WHATSAPP,
        tiktokUsername: '@boutique.ama',
        startsAt: new Date().toISOString(),
        demo: true,
        productIds: [pagne, sac],
      })
      .expect(201);
    liveId = (res.body as { id: string }).id;
    // No review and no fee for a demo of the advertiser's own live.
    expect(res.body).toMatchObject({ status: 'ACTIVE', serviceFee: 0 });
    await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Live',
        mode: 'SELF',
        whatsapp: WHATSAPP,
        tiktokUsername: 'x',
        startsAt: new Date().toISOString(),
      })
      .expect(400);
    await http().get(`/me/live/sales/${liveId}`).set(auth(other)).expect(404);

    res = await http()
      .post(`/me/live/sales/${liveId}/start`)
      .set(auth(seller))
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'RUNNING',
      running: true,
      tiktokUsername: 'boutique.ama',
    });

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
    expect(b.sessions[0]).toMatchObject({ status: 'ENDED', running: false });
    expect(b.live.status).toBe('COMPLETED');

    const byUser = new Map(b.leads.map((l) => [l.tiktokUser, l]));
    const edem = byUser.get('edem228')!;
    expect(edem).toMatchObject({
      intent: 'achat',
      items: [{ name: 'Pagne wax', quantity: 2, unitPrice: 5000 }],
      total: 10000,
      status: 'NEW',
    });
    // Viewzo only tells the buyer to write to the shop with their code.
    expect(edem.reply).toContain(
      `Écris ${edem.code} à la boutique sur WhatsApp : wa.me/22890000001`,
    );
    expect(edem.whatsappLink).toBe(
      `https://wa.me/22890000001?text=${edem.code}`,
    );
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
        mode: 'SELF',
        whatsapp: WHATSAPP,
        tiktokUsername: 'boutique.ama',
        startsAt: new Date().toISOString(),
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

  it('takes the comment-reading fee of the advertiser’s own live once', async () => {
    let res = await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Mon live',
        mode: 'SELF',
        whatsapp: WHATSAPP,
        tiktokUsername: 'boutique.ama',
        startsAt: new Date().toISOString(),
      })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'ACTIVE', serviceFee: 2000 });
    const id = (res.body as { id: string }).id;
    res = await http()
      .post(`/me/live/sales/${id}/start`)
      .set(auth(seller))
      .expect(400);
    expect(text((res.body as { message: string }).message)).toContain(
      'Solde insuffisant',
    );
    await deposit(sellerId, 2500);
    noTikTok();
    await http()
      .post(`/me/live/sales/${id}/start`)
      .set(auth(seller))
      .expect(200);
    noTikTok();
    // Resuming after a dropped connection is not charged again.
    await http()
      .post(`/me/live/sales/${id}/start`)
      .set(auth(seller))
      .expect(200);
    const fees = await prisma.transaction.findMany({
      where: { liveId: id, type: 'COMMISSION' },
    });
    expect(fees.map((f) => f.amount)).toEqual([-2000]);
    await http()
      .post(`/me/live/sales/${id}/stop`)
      .set(auth(seller))
      .expect(200);
  });

  let offerId: string;
  const creators: Record<string, { token: string; id: string }> = {};

  async function makeCreator(
    name: string,
    phone: string,
    followers: number,
    live = true,
  ) {
    const token = await login(phone);
    const { id } = await prisma.user.findUniqueOrThrow({ where: { phone } });
    await prisma.userProfile.create({ data: { userId: id, type: 'CREATOR' } });
    await prisma.socialAccount.create({
      data: {
        userId: id,
        network: 'TIKTOK',
        handle: `@${name}`,
        handleKey: name,
        verificationCode: `VZ-94${phone.slice(-4)}`,
        status: 'ELIGIBLE',
        followers,
      },
    });
    await prisma.creatorSkills.create({
      data: {
        userId: id,
        taskTypes: live
          ? ['POST_PROVIDED_VIDEO', 'LIVE_SELLING']
          : ['POST_PROVIDED_VIDEO'],
        showsFace: true,
        languages: ['Français'],
        countries: ['TG'],
        themes: ['Mode'],
        tasksPerWeek: 3,
      },
    });
    creators[name] = { token, id };
  }

  const as = (name: string) => auth(creators[name].token);
  const home = async (name: string) =>
    (await http().get('/me/live-tasks').set(as(name)).expect(200))
      .body as CreatorHome;

  async function newOffer(slots: number, budget: number) {
    const res = await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: `Offre ${slots}/${budget}`,
        whatsapp: WHATSAPP,
        startsAt: inMinutes(-1).toISOString(),
        endsAt: inMinutes(2 * 24 * 60).toISOString(),
        slots,
        budget,
        countries: ['TG'],
        productIds: [sac],
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    return id;
  }

  async function approve(id: string) {
    await http().post(`/me/live/sales/${id}/pay`).set(auth(seller)).expect(200);
    await http()
      .post(`/staff/live/sales/${id}/review`)
      .set(auth(moderator))
      .send({ status: 'ACTIVE' })
      .expect(200);
  }

  async function runFor(
    name: string,
    sessionId: string,
    minutes: number,
    peak: number,
  ) {
    noTikTok();
    await http()
      .post(`/me/live-tasks/sessions/${sessionId}/start`)
      .set(as(name))
      .expect(200);
    await prisma.liveSession.update({
      where: { id: sessionId },
      data: { startedAt: inMinutes(-minutes), peakViewers: peak },
    });
    return (
      await http()
        .post(`/me/live-tasks/sessions/${sessionId}/stop`)
        .set(as(name))
        .expect(200)
    ).body as Session;
  }

  it('lets the advertiser announce an offer without a TikTok account', async () => {
    await makeCreator('akos', '+22894200011', 5_000);
    await makeCreator('dela', '+22894200012', 2_000);
    await makeCreator('petit', '+22894200013', 500);
    await makeCreator('nolive', '+22894200014', 9_000, false);
    await makeCreator('sena', '+22894200015', 3_000);
    await makeCreator('yao', '+22894200016', 1_500);

    await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Sans période',
        whatsapp: WHATSAPP,
        startsAt: new Date().toISOString(),
        slots: 2,
        budget: 20_000,
        countries: ['TG'],
      })
      .expect(400);
    await http()
      .post('/me/live/sales')
      .set(auth(seller))
      .send({
        title: 'Trop peu',
        whatsapp: WHATSAPP,
        startsAt: new Date().toISOString(),
        endsAt: inMinutes(60).toISOString(),
        slots: 5,
        budget: 2_000,
        countries: ['TG'],
      })
      .expect(400);
    offerId = await newOffer(2, 20_000);
    let b = await board(offerId);
    expect(b.live).toMatchObject({
      status: 'PENDING_PAYMENT',
      mode: 'CREATORS',
      whatsapp: '+22890000001',
    });
    expect(b.sessions).toEqual([]);

    // Paid from the wallet, then reviewed like a campaign.
    const res = await http()
      .post(`/me/live/sales/${offerId}/pay`)
      .set(auth(seller))
      .expect(400);
    expect(text((res.body as { message: string }).message)).toContain(
      'recharge 19 500 FCFA',
    );
    await deposit(sellerId, 30_000);
    await http()
      .post(`/me/live/sales/${offerId}/pay`)
      .set(auth(seller))
      .expect(200);
    await http()
      .post(`/me/live/sales/${offerId}/pay`)
      .set(auth(seller))
      .expect(409);
    b = await board(offerId);
    expect(b.live.status).toBe('PENDING_REVIEW');
    expect((await home('akos')).offers).toEqual([]);
    await http()
      .post(`/me/live/sales/${offerId}/invite`)
      .set(auth(seller))
      .send({ creatorId: creators.dela.id })
      .expect(404);

    await http()
      .post(`/staff/live/sales/${offerId}/review`)
      .set(auth(moderator))
      .send({ status: 'REJECTED' })
      .expect(400);
    await http()
      .post(`/staff/live/sales/${offerId}/review`)
      .set(auth(seller))
      .send({ status: 'ACTIVE' })
      .expect(403);
    await http()
      .post(`/staff/live/sales/${offerId}/review`)
      .set(auth(moderator))
      .send({ status: 'ACTIVE' })
      .expect(200);
    const told = await prisma.notification.findMany({
      where: { type: 'LIVE_UPDATED', link: '/lives' },
      select: { userId: true },
    });
    const toldIds = told.map((n) => n.userId);
    expect(toldIds).toContain(creators.akos.id);
    expect(toldIds).not.toContain(creators.petit.id);
    expect(toldIds).not.toContain(creators.nolive.id);
  });

  it('needs the live skill and 1,000 TikTok followers', async () => {
    let h = await home('petit');
    expect(h.eligibility).toMatchObject({ eligible: false });
    expect(text(h.eligibility.reason)).toContain('1 000 abonnés');
    expect(h.offers).toEqual([]);
    h = await home('nolive');
    expect(text(h.eligibility.reason)).toContain('Faire des lives de vente');
    await http()
      .post(`/me/live-tasks/offers/${offerId}/accept`)
      .set(as('petit'))
      .send({ scheduledAt: inMinutes(60).toISOString() })
      .expect(403);

    h = await home('akos');
    expect(h.eligibility).toMatchObject({
      eligible: true,
      tiktok: { username: 'akos', followers: 5_000 },
    });
    // 10,000 FCFA per place, of which the creator keeps 45 %.
    expect(h.offers).toEqual([
      expect.objectContaining({
        id: offerId,
        placesLeft: 2,
        maxEarning: 4_500,
        ratePer100: 450,
        products: [{ name: 'Sac noir', price: 11_000 }],
      }),
    ]);

    const res = await http()
      .get(`/me/live/sales/${offerId}/candidates`)
      .set(auth(seller))
      .expect(200);
    const names = (res.body as { tiktokUsername: string }[]).map(
      (c) => c.tiktokUsername,
    );
    expect(names).toEqual(['akos', 'sena', 'dela', 'yao']);
  });

  let akosSession: string;

  it('fills the places: invitations, then first come, first served', async () => {
    let res = await http()
      .post(`/me/live/sales/${offerId}/invite`)
      .set(auth(seller))
      .send({ creatorId: creators.dela.id })
      .expect(201);
    const delaSession = (res.body as Session).id;
    expect(res.body).toMatchObject({
      status: 'INVITED',
      tiktokUsername: 'dela',
    });
    await http()
      .post(`/me/live/sales/${offerId}/invite`)
      .set(auth(seller))
      .send({ creatorId: creators.petit.id })
      .expect(403);
    expect((await home('dela')).sessions[0]).toMatchObject({
      id: delaSession,
      status: 'INVITED',
    });

    await http()
      .post(`/me/live-tasks/offers/${offerId}/accept`)
      .set(as('akos'))
      .send({ scheduledAt: inMinutes(5 * 24 * 60).toISOString() })
      .expect(400);
    res = await http()
      .post(`/me/live-tasks/offers/${offerId}/accept`)
      .set(as('akos'))
      .send({ scheduledAt: inMinutes(60).toISOString() })
      .expect(201);
    akosSession = (res.body as Session).id;
    expect(res.body).toMatchObject({
      status: 'ACCEPTED',
      tiktokUsername: 'akos',
      followers: 5_000,
    });
    await http()
      .post(`/me/live-tasks/offers/${offerId}/accept`)
      .set(as('akos'))
      .send({ scheduledAt: inMinutes(60).toISOString() })
      .expect(409);

    // Akos and the invitation hold both places.
    expect((await home('sena')).offers).toEqual([]);
    await http()
      .post(`/me/live-tasks/offers/${offerId}/accept`)
      .set(as('sena'))
      .send({ scheduledAt: inMinutes(90).toISOString() })
      .expect(409);

    await http()
      .post(`/me/live-tasks/sessions/${delaSession}/respond`)
      .set(as('akos'))
      .send({ accept: false })
      .expect(404);
    res = await http()
      .post(`/me/live-tasks/sessions/${delaSession}/respond`)
      .set(as('dela'))
      .send({ accept: false })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'DECLINED' });
    // Declining an invitation costs nothing.
    expect((await home('dela')).eligibility.eligible).toBe(true);

    res = await http()
      .post(`/me/live-tasks/offers/${offerId}/accept`)
      .set(as('sena'))
      .send({ scheduledAt: inMinutes(90).toISOString() })
      .expect(201);
    const senaSession = (res.body as Session).id;
    await http()
      .patch(`/me/live-tasks/sessions/${senaSession}`)
      .set(as('sena'))
      .send({ scheduledAt: inMinutes(120).toISOString() })
      .expect(200);

    // Withdrawing: no live for 10 days.
    res = await http()
      .post(`/me/live-tasks/sessions/${senaSession}/withdraw`)
      .set(as('sena'))
      .expect(200);
    expect(res.body).toMatchObject({ status: 'WITHDRAWN', withdrawStreak: 1 });
    const h = await home('sena');
    expect(h.eligibility.eligible).toBe(false);
    expect(text(h.eligibility.reason)).toContain('Après ton retrait');
    await http()
      .post(`/me/live-tasks/sessions/${senaSession}/start`)
      .set(as('sena'))
      .expect(409);
  });

  it('pays a creator’s live by viewers at the peak, capped per place', async () => {
    // Under 15 minutes: nothing.
    const short = await runFor('akos', akosSession, 10, 1_250);
    expect(short).toMatchObject({ status: 'ENDED', payout: 'NONE', earned: 0 });
    expect(short.payoutReason).toContain('moins de 15 minutes');

    await prisma.liveSession.update({
      where: { id: akosSession },
      data: { status: 'ACCEPTED', payout: 'NONE', payoutReason: null },
    });
    // 12 × 1,000 FCFA billed, capped at the place's 10,000 FCFA.
    const paid = await runFor('akos', akosSession, 40, 1_250);
    expect(paid).toMatchObject({
      payout: 'PAID',
      cost: 10_000,
      earned: 4_500,
    });
    const earning = await prisma.transaction.findFirstOrThrow({
      where: { liveSessionId: akosSession, type: 'EARNING' },
    });
    expect(earning.amount).toBe(4_500);
    const b = await board(offerId);
    expect(b.live.spent).toBe(10_000);
  });

  let yaoSession: string;

  it('holds an unusual audience for the team before paying', async () => {
    const res = await http()
      .post(`/me/live-tasks/offers/${offerId}/accept`)
      .set(as('yao'))
      .send({ scheduledAt: inMinutes(30).toISOString() })
      .expect(201);
    yaoSession = (res.body as Session).id;
    // More viewers than followers.
    const ended = await runFor('yao', yaoSession, 30, 3_000);
    expect(ended).toMatchObject({ payout: 'TO_REVIEW', earned: 0 });
    expect(ended.flag).toContain('Plus de spectateurs que d’abonnés');

    // Closing waits for the team's decision.
    await prisma.liveSale.update({
      where: { id: offerId },
      data: { endsAt: inMinutes(-1) },
    });
    await app.get(LiveOffersService).closeDue();
    expect((await board(offerId)).live.status).toBe('ACTIVE');

    const list = await http()
      .get('/staff/live/sessions?payout=TO_REVIEW')
      .set(auth(moderator))
      .expect(200);
    expect((list.body as Session[]).map((s) => s.id)).toContain(yaoSession);
    await http()
      .post(`/staff/live/sessions/${yaoSession}/payout`)
      .set(auth(moderator))
      .send({ decision: 'REFUSE' })
      .expect(400);
    const decided = await http()
      .post(`/staff/live/sessions/${yaoSession}/payout`)
      .set(auth(moderator))
      .send({
        decision: 'PAY',
        peakViewers: 900,
        reason: 'Audience corrigée',
      })
      .expect(200);
    expect(decided.body).toMatchObject({
      payout: 'PAID',
      peakViewers: 900,
      cost: 9_000,
      earned: 4_050,
    });

    // The decision closed the offer: 20,000 − 10,000 − 9,000 comes back.
    const b = await board(offerId);
    expect(b.live).toMatchObject({
      status: 'COMPLETED',
      spent: 19_000,
      refunded: 1_000,
    });
    const refund = await prisma.transaction.findFirstOrThrow({
      where: { liveId: offerId, type: 'REFUND' },
    });
    expect(refund.amount).toBe(1_000);
  });

  it('counts a live not done as a withdrawal and bans after three', async () => {
    const id = await newOffer(3, 3_000);
    await approve(id);
    await prisma.liveCreatorStanding.update({
      where: { userId: creators.sena.id },
      data: { withdrawStreak: 2, blockedUntil: inMinutes(-1) },
    });
    let res = await http()
      .post(`/me/live-tasks/offers/${id}/accept`)
      .set(as('sena'))
      .send({ scheduledAt: inMinutes(60).toISOString() })
      .expect(201);
    await http()
      .post(`/me/live-tasks/sessions/${(res.body as Session).id}/withdraw`)
      .set(as('sena'))
      .expect(200);
    expect(text((await home('sena')).eligibility.reason)).toContain(
      '3 retraits de suite',
    );

    await http()
      .post(`/me/live-tasks/offers/${id}/accept`)
      .set(as('dela'))
      .send({ scheduledAt: inMinutes(60).toISOString() })
      .expect(201);
    await prisma.liveSale.update({
      where: { id },
      data: { endsAt: inMinutes(-1) },
    });
    await app.get(LiveOffersService).closeDue();
    res = await http().get('/me/live-tasks').set(as('dela')).expect(200);
    const dela = res.body as CreatorHome;
    expect(dela.sessions.find((s) => s.offer.id === id)).toMatchObject({
      status: 'MISSED',
    });
    expect(dela.eligibility.eligible).toBe(false);
    const b = await board(id);
    expect(b.live).toMatchObject({ status: 'COMPLETED', refunded: 3_000 });
  });

  it('lets the seller withdraw an offer and the team stop one', async () => {
    let id = await newOffer(1, 2_000);
    await http().post(`/me/live/sales/${id}/pay`).set(auth(seller)).expect(200);
    let res = await http()
      .post(`/me/live/sales/${id}/cancel`)
      .set(auth(seller))
      .expect(200);
    expect(res.body).toMatchObject({ cancelled: true, refunded: 2_000 });

    id = await newOffer(1, 2_000);
    await approve(id);
    res = await http()
      .post(`/me/live-tasks/offers/${id}/accept`)
      .set(as('akos'))
      .send({ scheduledAt: inMinutes(10).toISOString() })
      .expect(201);
    const session = (res.body as Session).id;
    noTikTok();
    await http()
      .post(`/me/live-tasks/sessions/${session}/start`)
      .set(as('akos'))
      .expect(200);
    await http()
      .post(`/me/live/sales/${id}/cancel`)
      .set(auth(seller))
      .expect(409);

    res = await http()
      .get('/staff/live/sales?status=ACTIVE')
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
      statusReason: 'Plainte de clients',
    });
    expect(
      await prisma.liveSession.findUniqueOrThrow({ where: { id: session } }),
    ).toMatchObject({ status: 'CANCELLED', payout: 'NONE' });
    await http()
      .post(`/me/live-tasks/sessions/${session}/start`)
      .set(as('akos'))
      .expect(409);
  });

  it('lets super admins set the prices per country', async () => {
    const rate = {
      advertiserPer100: 2_000,
      creatorPer100: 900,
      selfFee: 3_000,
    };
    await http()
      .put('/staff/live/rates/TG')
      .set(auth(moderator))
      .send(rate)
      .expect(403);
    await http()
      .put('/staff/live/rates/TG')
      .set(auth(admin))
      .send({ ...rate, creatorPer100: 2_500 })
      .expect(400);
    await http()
      .put('/staff/live/rates/TG')
      .set(auth(admin))
      .send(rate)
      .expect(200);
    const res = await http()
      .get('/staff/live/rates')
      .set(auth(moderator))
      .expect(200);
    expect(
      (res.body as { rates: { country: string }[] }).rates.find(
        (r) => r.country === 'TG',
      ),
    ).toMatchObject({ ...rate, custom: true });
    expect((await home('akos')).offers).toEqual([]);
    await prisma.liveRate.deleteMany({ where: { country: 'TG' } });
  });

  it('hides everything again once switched off', async () => {
    await setModule(false);
    await http().get('/me/live/sales').set(auth(seller)).expect(404);
    await http().get('/staff/live/sales').set(auth(admin)).expect(404);
    const res = await http().get('/modules').expect(200);
    expect(res.body).not.toContain('LIVE_SALES');
  });
});
