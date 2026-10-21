import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';
import { SMS_SENDER, SmsSender } from '../src/sms/sms-sender';
import { PostsScheduler } from '../src/posts/posts.scheduler';

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
describe('Paid views, dated screenshots and disputes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jobs: PostsScheduler;
  let finance: string;
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

  const walletOf = async (token: string) =>
    (await http().get('/me/wallet').set(auth(token)).expect(200)).body as {
      available: number;
      held: number;
      frozen: number;
    };

  const post = (id: string) =>
    prisma.taskAssignment.findUniqueOrThrow({ where: { id } });

  const views = (assignmentId: string, totalViews: number, status = 200) =>
    http()
      .post(`/staff/assignments/${assignmentId}/views`)
      .set(auth(staff))
      .send({ totalViews })
      .expect(status);

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
    jobs = app.get(PostsScheduler);
    await prisma.transaction.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.user.deleteMany();
    await prisma.countryCounter.deleteMany();
    await prisma.otpChallenge.deleteMany();

    advertiser = await login('+22897000001');
    creator = await login('+22897000002');
    staff = await login('+22897000003');
    await prisma.user.update({
      where: { phone: '+22897000003' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
    finance = await login('+22897000004');
    await prisma.user.update({
      where: { phone: '+22897000004' },
      data: { role: 'STAFF', staffRole: 'FINANCE' },
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
      where: { phone: '+22897000002' },
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
        verificationCode: 'VZ-900202',
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

  it('pays and bills a post only from 500 validated views', async () => {
    const { campaignId, assignmentId } = await submittedCampaign(25_000);
    await views(assignmentId, 400);
    expect(await post(assignmentId)).toMatchObject({
      validViews: 400,
      earned: 0,
      reviewStatus: 'VALIDATED',
    });
    expect(
      await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ).toMatchObject({ spent: 0 });
    const bell = await prisma.notification.findFirstOrThrow({
      where: { type: 'POST_VALIDATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(bell.body).toContain('500 vues');

    await views(assignmentId, 1_000);
    const paid = await post(assignmentId);
    expect(paid.earned).toBeGreaterThan(0);
    expect(
      await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ).toMatchObject({ spent: 1_000 });

    // The creator contests the count: the post's earnings are frozen.
    await http()
      .post(`/me/posts/${assignmentId}/disputes`)
      .set(auth(creator))
      .send({ reason: 'J’ai 2 000 vues sur ma capture' })
      .expect(201);
    expect(await walletOf(creator)).toMatchObject({
      frozen: paid.earned,
      held: 0,
    });
    await http()
      .post(`/me/posts/${assignmentId}/disputes`)
      .set(auth(advertiser))
      .send({ reason: 'Je conteste aussi' })
      .expect(409);

    const queue = await http()
      .get('/staff/disputes')
      .set(auth(staff))
      .expect(200);
    const body = queue.body as {
      open: number;
      overdue: number;
      items: { id: string; side: string; overdue: boolean }[];
    };
    expect(body).toMatchObject({ open: 1, overdue: 0 });
    const [dispute] = body.items;
    expect(dispute).toMatchObject({ side: 'CREATOR', overdue: false });

    // Older than 72 h: flagged.
    await prisma.dispute.update({
      where: { id: dispute.id },
      data: { createdAt: new Date(Date.now() - 73 * hour) },
    });
    const late = await http()
      .get('/staff/disputes')
      .set(auth(staff))
      .expect(200);
    expect(late.body).toMatchObject({
      overdue: 1,
      items: [{ id: dispute.id, overdue: true }],
    });

    // Finance reads but does not decide; a reason is required.
    await http()
      .post(`/staff/disputes/${dispute.id}/decide`)
      .set(auth(finance))
      .send({ outcome: 'KEEP', reason: 'Ok' })
      .expect(403);
    await http()
      .post(`/staff/disputes/${dispute.id}/decide`)
      .set(auth(staff))
      .send({ outcome: 'SET_VIEWS', views: 2_000 })
      .expect(400);
    await http()
      .post(`/staff/disputes/${dispute.id}/decide`)
      .set(auth(staff))
      .send({
        outcome: 'SET_VIEWS',
        views: 2_000,
        reason: 'Capture vérifiée',
      })
      .expect(200);
    const after = await post(assignmentId);
    expect(after).toMatchObject({ validViews: 2_000 });
    expect(after.earned).toBeGreaterThan(paid.earned);
    expect(await walletOf(creator)).toMatchObject({
      frozen: 0,
      held: after.earned,
    });
    await http()
      .post(`/staff/disputes/${dispute.id}/decide`)
      .set(auth(staff))
      .send({ outcome: 'KEEP', reason: 'Encore' })
      .expect(409);
    // One dispute per side and post.
    await http()
      .post(`/me/posts/${assignmentId}/disputes`)
      .set(auth(creator))
      .send({ reason: 'Encore une fois' })
      .expect(409);

    const tasks = await http()
      .get('/me/assignments')
      .set(auth(creator))
      .expect(200);
    const mine = (
      tasks.body as {
        id: string;
        minPaidViews: number;
        dispute: { outcome: string } | null;
      }[]
    ).find((a) => a.id === assignmentId)!;
    expect(mine).toMatchObject({
      minPaidViews: 500,
      dispute: { outcome: 'SET_VIEWS' },
    });
    const journal = await prisma.auditLog.findMany({
      where: { entity: 'Dispute', entityId: dispute.id },
    });
    expect(journal.map((j) => j.action).sort()).toEqual([
      'dispute.decide',
      'dispute.open',
    ]);
  });

  it('lets the advertiser contest a validated post and takes its earnings back', async () => {
    const { campaignId, assignmentId } = await submittedCampaign(25_000);
    await http()
      .post(`/me/posts/${assignmentId}/disputes`)
      .set(auth(advertiser))
      .send({ reason: 'Pas encore validée' })
      .expect(400);
    await views(assignmentId, 3_000);
    const outsider = await login('+22897000009');
    await http()
      .post(`/me/posts/${assignmentId}/disputes`)
      .set(auth(outsider))
      .send({ reason: 'Je ne suis pas concerné' })
      .expect(404);
    const opened = await http()
      .post(`/me/posts/${assignmentId}/disputes`)
      .set(auth(advertiser))
      .send({ reason: 'La vidéo ne montre pas le produit' })
      .expect(201);
    const disputeId = (opened.body as { id: string }).id;
    const warned = await prisma.notification.findFirst({
      where: { type: 'DISPUTE_UPDATED', title: { contains: 'contestée' } },
    });
    expect(warned).not.toBeNull();

    // Even earnings past their hold stay out of reach while frozen.
    await prisma.transaction.updateMany({
      where: { assignmentId },
      data: { availableAt: new Date(Date.now() - day) },
    });
    const frozen = await walletOf(creator);
    expect(frozen.frozen).toBeGreaterThan(0);

    await http()
      .post(`/staff/disputes/${disputeId}/decide`)
      .set(auth(staff))
      .send({ outcome: 'REJECT_POST', reason: 'Produit absent de la vidéo' })
      .expect(200);
    expect(await post(assignmentId)).toMatchObject({
      reviewStatus: 'REJECTED',
      reviewReason: 'Produit absent de la vidéo',
      validViews: 0,
      earned: 0,
    });
    expect(
      await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ).toMatchObject({ spent: 0 });
    expect(await walletOf(creator)).toMatchObject({
      frozen: 0,
      available: frozen.available,
    });
    const report = await http()
      .get(`/me/campaigns/${campaignId}/report`)
      .set(auth(advertiser))
      .expect(200);
    expect(report.body).toMatchObject({ verifiedViews: 0 });
  });

  it('reminds dated screenshots at H+1, J+1, J+7 and J+30', async () => {
    const { assignmentId } = await submittedCampaign(25_000);
    const { submittedAt } = await post(assignmentId);
    // Only this post's reminders are looked at.
    await prisma.taskAssignment.updateMany({
      where: { id: { not: assignmentId } },
      data: { captureRemindersSent: 4 },
    });
    const t0 = submittedAt!.getTime();
    const reminders = () =>
      prisma.notification.count({
        where: {
          type: 'PROOF_REMINDER',
          title: { contains: 'Capture' },
          body: { contains: 'toujours en ligne' },
        },
      });
    const start = await reminders();

    expect(await jobs.sendCaptureReminders(new Date(t0 + 30 * 60_000))).toBe(0);
    expect(await jobs.sendCaptureReminders(new Date(t0 + 2 * hour))).toBe(1);
    expect(await jobs.sendCaptureReminders(new Date(t0 + 3 * hour))).toBe(0);
    // A screenshot already sent for J+1: no reminder, the step still counts.
    await prisma.postProof.create({
      data: {
        assignmentId,
        kind: 'SCREENSHOT',
        uploadedAt: new Date(t0 + 20 * hour),
        declaredViews: 900,
      },
    });
    expect(await jobs.sendCaptureReminders(new Date(t0 + day + hour))).toBe(0);
    expect(await jobs.sendCaptureReminders(new Date(t0 + 7 * day + hour))).toBe(
      1,
    );
    expect(
      await jobs.sendCaptureReminders(new Date(t0 + 30 * day + hour)),
    ).toBe(1);
    expect(await reminders()).toBe(start + 3);
    expect(await post(assignmentId)).toMatchObject({
      captureRemindersSent: 4,
    });

    const tasks = await http()
      .get('/me/assignments')
      .set(auth(creator))
      .expect(200);
    const mine = (
      tasks.body as {
        id: string;
        capturePlan: { steps: { label: string; doneAt: string | null }[] };
      }[]
    ).find((a) => a.id === assignmentId)!;
    expect(mine.capturePlan.steps.map((s) => s.label)).toEqual([
      'H+1',
      'J+1',
      'J+7',
      'J+30',
    ]);
    expect(mine.capturePlan.steps[1].doneAt).not.toBeNull();
  });

  it('checks posts are still online after 30 days', async () => {
    const { campaignId, assignmentId } = await submittedCampaign(25_000);
    await views(assignmentId, 4_000);
    const due = async () =>
      (
        (
          await http()
            .get('/staff/posts?status=ONLINE_CHECK')
            .set(auth(staff))
            .expect(200)
        ).body as { counts: { ONLINE_CHECK: number }; items: { id: string }[] }
      ).items.map((i) => i.id);
    expect(await due()).not.toContain(assignmentId);

    await prisma.taskAssignment.update({
      where: { id: assignmentId },
      data: { submittedAt: new Date(Date.now() - 31 * day) },
    });
    expect(await due()).toContain(assignmentId);
    const before = await post(assignmentId);
    const earnings = await prisma.transaction.findMany({
      where: { assignmentId, type: 'EARNING' },
    });
    expect(earnings).toHaveLength(1);
    // Half the earnings already free to withdraw: they stay with the creator.
    const half = Math.floor(before.earned / 2);
    await prisma.transaction.update({
      where: { id: earnings[0].id },
      data: { amount: before.earned - half },
    });
    await prisma.transaction.create({
      data: {
        userId: before.creatorId,
        type: 'EARNING',
        amount: half,
        availableAt: new Date(Date.now() - day),
        campaignId,
        assignmentId,
      },
    });

    await http()
      .post(`/staff/posts/${assignmentId}/review`)
      .set(auth(staff))
      .send({ decision: 'REMOVED' })
      .expect(400);
    await http()
      .post(`/staff/posts/${assignmentId}/review`)
      .set(auth(staff))
      .send({ decision: 'REMOVED', reason: 'Vidéo supprimée de TikTok' })
      .expect(200);
    const removed = await post(assignmentId);
    expect(removed).toMatchObject({
      reviewStatus: 'REJECTED',
      stillOnline: false,
      earned: half,
      validViews: 2_000,
    });
    expect(removed.onlineCheckedAt).not.toBeNull();
    expect(
      await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ).toMatchObject({ spent: 2_000 });
    expect(await due()).not.toContain(assignmentId);
    await http()
      .post(`/staff/posts/${assignmentId}/review`)
      .set(auth(staff))
      .send({ decision: 'STILL_ONLINE' })
      .expect(400);
  });
});
