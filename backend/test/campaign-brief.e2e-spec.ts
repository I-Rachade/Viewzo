import { INestApplication } from '@nestjs/common';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CampaignFilesService } from '../src/files/campaign-files.service';
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
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const MP3 = Buffer.concat([Buffer.from('ID3\x04', 'latin1'), Buffer.alloc(64)]);

interface FileView {
  id: string;
  purpose: string;
  kind: string;
  name: string;
  url: string;
}
interface CampaignView {
  id: string;
  status: string;
  contentCase: string;
  keyMessage: string;
  files: FileView[];
  platforms: { network: string; budget: number }[];
}

// Runs with PAYMENT_MODE=local: every Mobile Money payment succeeds at once.
describe('Campaign brief, files and statuses (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let advertiser: string;
  let other: string;
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

  function upload(
    token: string,
    body: Buffer,
    name: string,
    purpose = 'ASSET',
  ) {
    return http()
      .post('/me/campaign-files')
      .set(auth(token))
      .field('purpose', purpose)
      .attach('file', body, name);
  }

  const form = (extra: Record<string, unknown> = {}) => ({
    title: 'Jus Bissap',
    objective: 'SALES',
    countries: ['TG'],
    startsAt: new Date(Date.now() - day).toISOString(),
    endsAt: new Date(Date.now() + 7 * day).toISOString(),
    package: 'BASIC',
    budget: 30_000,
    platforms: [{ network: 'TIKTOK', contentType: 'PROVIDED_ASSETS' }],
    contentCase: 'READY',
    language: 'Français',
    keyMessage: 'Le bissap qui rafraîchit',
    callToAction: 'Commande sur WhatsApp',
    caption: 'Le vrai goût du bissap #Lomé',
    sound: 'Afrobeat calme',
    ...extra,
  });

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'viewzo-files-'));
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

    advertiser = await login('+22897000001');
    other = await login('+22897000002');
    creator = await login('+22897000003');
    staff = await login('+22897000004');
    await prisma.user.update({
      where: { phone: '+22897000004' },
      data: { role: 'STAFF', staffRole: 'SUPER_ADMIN' },
    });
    for (const token of [advertiser, other]) {
      await http()
        .post('/me/profiles')
        .set(auth(token))
        .send({ type: 'ADVERTISER' })
        .expect(201);
    }
    const deposit = await http()
      .post('/me/wallet/deposits')
      .set(auth(advertiser))
      .send({ amount: 50_000 })
      .expect(201);
    await http()
      .get(`/payments/${(deposit.body as { reference: string }).reference}`)
      .set(auth(advertiser))
      .expect(200);

    const c = await prisma.user.findUniqueOrThrow({
      where: { phone: '+22897000003' },
    });
    await prisma.userProfile.create({
      data: { userId: c.id, type: 'CREATOR' },
    });
    await prisma.socialAccount.create({
      data: {
        userId: c.id,
        network: 'TIKTOK',
        handle: '@efua',
        handleKey: 'efua',
        verificationCode: 'VZ-900201',
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

  it('keeps real files, checked by their content', async () => {
    await upload(creator, PNG, 'affiche.png').expect(403);
    await upload(advertiser, Buffer.from('<html><script>'), 'x.png').expect(
      400,
    );
    // A brief is spoken or filmed.
    await upload(advertiser, PNG, 'affiche.png', 'BRIEF').expect(400);

    const res = await upload(advertiser, PNG, 'affiche.png').expect(201);
    const file = res.body as FileView;
    expect(file).toMatchObject({
      purpose: 'ASSET',
      kind: 'IMAGE',
      name: 'affiche.png',
    });
    const url = new URL(file.url);
    const opened = await http()
      .get(`${url.pathname}${url.search}`)
      .expect(200)
      .expect('Content-Type', 'image/png');
    expect(Buffer.compare(opened.body as Buffer, PNG)).toBe(0);
    // A forged or expired link opens nothing.
    await http()
      .get(`${url.pathname}?exp=${Date.now() + day}&sig=forged`)
      .expect(404);
  });

  it('saves a draft, changes it, sends it, then pays it', async () => {
    const poster = (await upload(advertiser, PNG, 'affiche.png').expect(201))
      .body as FileView;
    const voice = (
      await upload(advertiser, MP3, 'brief.mp3', 'BRIEF').expect(201)
    ).body as FileView;

    // Ready content needs something to post.
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(form({ draft: true }))
      .expect(400);
    // Someone else's file can't be used.
    const foreign = (await upload(other, PNG, 'autre.png').expect(201))
      .body as FileView;
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(form({ draft: true, fileIds: [foreign.id] }))
      .expect(400);

    const created = await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(
        form({ draft: true, fileIds: [poster.id], briefFileIds: [voice.id] }),
      )
      .expect(201);
    const draft = created.body as CampaignView;
    expect(draft).toMatchObject({
      status: 'DRAFT',
      contentCase: 'READY',
      keyMessage: 'Le bissap qui rafraîchit',
    });
    expect(draft.files.map((f) => [f.name, f.purpose])).toEqual([
      ['affiche.png', 'ASSET'],
      ['brief.mp3', 'BRIEF'],
    ]);
    // A draft can't be paid.
    await http()
      .post(`/campaigns/${draft.id}/pay`)
      .set(auth(advertiser))
      .send({ method: 'WALLET' })
      .expect(400);

    // Changed: a bigger budget, the voice brief taken off.
    const changed = await http()
      .put(`/campaigns/${draft.id}`)
      .set(auth(advertiser))
      .send(form({ fileIds: [poster.id], budget: 40_000 }))
      .expect(200);
    expect(changed.body).toMatchObject({ status: 'DRAFT' });
    expect((changed.body as CampaignView).files).toHaveLength(1);
    expect((changed.body as CampaignView).platforms).toEqual([
      expect.objectContaining({ network: 'TIKTOK', budget: 40_000 }),
    ]);
    await http()
      .put(`/campaigns/${draft.id}`)
      .set(auth(other))
      .send(form({ fileIds: [poster.id] }))
      .expect(404);

    const sent = await http()
      .post(`/campaigns/${draft.id}/send`)
      .set(auth(advertiser))
      .expect(200);
    expect(sent.body).toMatchObject({ status: 'PENDING_PAYMENT' });
    await http()
      .post(`/campaigns/${draft.id}/send`)
      .set(auth(advertiser))
      .expect(409);

    await http()
      .post(`/campaigns/${draft.id}/pay`)
      .set(auth(advertiser))
      .send({ method: 'WALLET' })
      .expect(200);
    const paid = await http()
      .get(`/me/campaigns/${draft.id}`)
      .set(auth(advertiser))
      .expect(200);
    expect(paid.body).toMatchObject({ status: 'PENDING_REVIEW' });
    // Paid: no more changes.
    await http()
      .put(`/campaigns/${draft.id}`)
      .set(auth(advertiser))
      .send(form({ fileIds: [poster.id] }))
      .expect(409);
    await http()
      .delete(`/campaigns/${draft.id}`)
      .set(auth(advertiser))
      .expect(409);

    // The team checks the files and the brief.
    const queue = await http()
      .get('/staff/campaigns')
      .set(auth(staff))
      .expect(200);
    expect(queue.body).toEqual([
      expect.objectContaining({
        id: draft.id,
        keyMessage: 'Le bissap qui rafraîchit',
        files: [expect.objectContaining({ name: 'affiche.png' })],
      }),
    ]);
    await http()
      .post(`/staff/campaigns/${draft.id}/review`)
      .set(auth(staff))
      .send({ status: 'ACTIVE' })
      .expect(200);

    // The creator reads the whole brief.
    const tasks = await http().get('/me/tasks').set(auth(creator)).expect(200);
    const offered = tasks.body as {
      network: string;
      campaign: { files: FileView[] };
    }[];
    expect(offered.map((t) => t.network)).toEqual(['TIKTOK']);
    expect(offered[0].campaign).toMatchObject({
      keyMessage: 'Le bissap qui rafraîchit',
      callToAction: 'Commande sur WhatsApp',
      caption: 'Le vrai goût du bissap #Lomé',
      sound: 'Afrobeat calme',
    });
    expect(offered[0].campaign.files.map((f) => f.kind)).toEqual(['IMAGE']);
    expect(offered[0]).not.toHaveProperty('budget');

    // Paused: nobody new can take a task, then it opens again.
    await http()
      .post(`/campaigns/${draft.id}/resume`)
      .set(auth(advertiser))
      .expect(409);
    const paused = await http()
      .post(`/campaigns/${draft.id}/pause`)
      .set(auth(advertiser))
      .expect(200);
    expect(paused.body).toMatchObject({ status: 'PAUSED' });
    expect(
      (await http().get('/me/tasks').set(auth(creator)).expect(200)).body,
    ).toEqual([]);
    const [task] = (await prisma.campaignTask.findMany({
      where: { campaignId: draft.id, network: 'TIKTOK' },
    })) as { id: string }[];
    await http()
      .post(`/tasks/${task.id}/accept`)
      .set(auth(creator))
      .expect(403);
    // The money stays in escrow while paused.
    const wallet = await http().get('/me/wallet').set(auth(advertiser));
    expect(wallet.body).toMatchObject({ escrow: 40_000 });
    await http()
      .post(`/campaigns/${draft.id}/resume`)
      .set(auth(advertiser))
      .expect(200);
    await http()
      .post(`/tasks/${task.id}/accept`)
      .set(auth(creator))
      .expect(201);
    const journal = await prisma.auditLog.findMany({
      where: { entity: 'Campaign', entityId: draft.id },
    });
    expect(journal.map((j) => j.action)).toEqual(
      expect.arrayContaining(['campaign.pause', 'campaign.resume']),
    );
  });

  it('asks who creates when the advertiser brings nothing', async () => {
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(
        form({
          contentCase: 'NONE',
          platforms: [{ network: 'TIKTOK', contentType: 'FREE_BRIEF' }],
        }),
      )
      .expect(400);
    const created = await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(
        form({
          contentCase: 'NONE',
          noAssetsChoice: 'CREATOR_VIDEOS',
          budget: 25_000,
          platforms: [{ network: 'TIKTOK', contentType: 'FREE_BRIEF' }],
        }),
      )
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'PENDING_PAYMENT',
      contentCase: 'NONE',
      files: [],
    });
    // Partial material: a link to the rushes is enough.
    await http()
      .post('/campaigns')
      .set(auth(advertiser))
      .send(
        form({
          contentCase: 'PARTIAL',
          budget: 25_000,
          assetUrls: ['https://drive.example.com/rushes'],
          platforms: [{ network: 'TIKTOK', contentType: 'VIDEO_WITH_POSTERS' }],
        }),
      )
      .expect(201);
    // Unpaid campaigns can be deleted.
    await http()
      .delete(`/campaigns/${(created.body as CampaignView).id}`)
      .set(auth(advertiser))
      .expect(204);
    await http()
      .get(`/me/campaigns/${(created.body as CampaignView).id}`)
      .set(auth(advertiser))
      .expect(404);
  });

  it('removes files nobody attached after a day', async () => {
    const orphan = (await upload(advertiser, PNG, 'oubli.png').expect(201))
      .body as FileView;
    const files = app.get(CampaignFilesService);
    expect(await files.purgeOrphans()).toBe(0);
    const removed = await files.purgeOrphans(new Date(Date.now() + 2 * day));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.campaignFile.findUnique({ where: { id: orphan.id } }),
    ).toBeNull();
    // Attached files stay.
    expect(
      await prisma.campaignFile.count({ where: { campaignId: { not: null } } }),
    ).toBe(1);
  });
});
