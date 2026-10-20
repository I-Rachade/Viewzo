import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CampaignFile,
  CampaignFileKind,
  CampaignFilePurpose,
  Prisma,
  ProfileType,
} from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE } from './file-storage';
import type { FileStorage } from './file-storage';
import { MAX_FILE_BYTES, sniffFile } from './file-types';

// How long a signed file link works.
const LINK_TTL_MS = 6 * 3600 * 1000;
// Files sent but never attached to a campaign are removed after this.
const ORPHAN_AFTER_MS = 24 * 3600 * 1000;
// Unattached files a person may have at once.
const MAX_PENDING = 40;
export const MAX_ASSET_FILES = 20;
export const MAX_BRIEF_FILES = 2;

const SIZE_LABEL: Record<CampaignFileKind, string> = {
  IMAGE: 'image (10 Mo maximum)',
  PDF: 'PDF (10 Mo maximum)',
  AUDIO: 'audio (20 Mo maximum)',
  VIDEO: 'vidéo (100 Mo maximum)',
};

export interface UploadedFileData {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class CampaignFilesService {
  private readonly secret: string;
  private readonly publicUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
    this.publicUrl = config.get<string>(
      'API_PUBLIC_URL',
      'http://localhost:3001',
    );
  }

  /** Keeps a file for a campaign the advertiser is preparing. */
  async upload(
    ownerId: string,
    file: UploadedFileData | undefined,
    purpose: CampaignFilePurpose,
  ) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId_type: { userId: ownerId, type: ProfileType.ADVERTISER } },
    });
    if (!profile) {
      throw new ForbiddenException("Active d'abord le profil Annonceur");
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('Choisis un fichier');
    }
    const type = sniffFile(file.buffer);
    if (!type) {
      throw new BadRequestException(
        'Format non pris en charge : image, vidéo, audio ou PDF',
      );
    }
    if (
      purpose === CampaignFilePurpose.BRIEF &&
      type.kind !== CampaignFileKind.AUDIO &&
      type.kind !== CampaignFileKind.VIDEO
    ) {
      throw new BadRequestException('Le brief est un audio ou une vidéo');
    }
    if (file.size > MAX_FILE_BYTES[type.kind]) {
      throw new BadRequestException(
        `Fichier trop lourd pour une ${SIZE_LABEL[type.kind]}`,
      );
    }
    const pending = await this.prisma.campaignFile.count({
      where: { ownerId, campaignId: null },
    });
    if (pending >= MAX_PENDING) {
      throw new BadRequestException(
        'Trop de fichiers en attente : enregistre ta campagne d’abord',
      );
    }
    const key = `campaigns/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, type.mime);
    const saved = await this.prisma.campaignFile.create({
      data: {
        ownerId,
        purpose,
        kind: type.kind,
        name: fileName(file.originalname, type.ext),
        key,
        mimeType: type.mime,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      },
    });
    return this.view(saved);
  }

  /**
   * Gives a campaign exactly these files: the advertiser's own, not used by
   * another campaign. Files taken off the campaign wait for the cleanup.
   */
  async attach(
    tx: Tx,
    ownerId: string,
    campaignId: string,
    assetIds: string[],
    briefIds: string[],
  ) {
    const assets = [...new Set(assetIds)];
    const briefs = [...new Set(briefIds)];
    if (assets.length > MAX_ASSET_FILES) {
      throw new BadRequestException(
        `${MAX_ASSET_FILES} fichiers maximum par campagne`,
      );
    }
    if (briefs.length > MAX_BRIEF_FILES) {
      throw new BadRequestException(
        `${MAX_BRIEF_FILES} briefs audio ou vidéo maximum`,
      );
    }
    const ids = [...assets, ...briefs];
    const files = await tx.campaignFile.findMany({
      where: {
        id: { in: ids },
        ownerId,
        OR: [{ campaignId: null }, { campaignId }],
      },
    });
    const byId = new Map(files.map((f) => [f.id, f]));
    for (const [list, purpose] of [
      [assets, CampaignFilePurpose.ASSET],
      [briefs, CampaignFilePurpose.BRIEF],
    ] as const) {
      for (const id of list) {
        if (byId.get(id)?.purpose !== purpose) {
          throw new BadRequestException(
            'Fichier introuvable : envoie-le à nouveau',
          );
        }
      }
    }
    await tx.campaignFile.updateMany({
      where: { campaignId, id: { notIn: ids } },
      data: { campaignId: null },
    });
    if (ids.length) {
      await tx.campaignFile.updateMany({
        where: { id: { in: ids } },
        data: { campaignId },
      });
    }
  }

  /** The files of each campaign, oldest first, with signed links. */
  async forCampaigns(campaignIds: string[]) {
    const files = campaignIds.length
      ? await this.prisma.campaignFile.findMany({
          where: { campaignId: { in: campaignIds } },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const out = new Map<string, ReturnType<CampaignFilesService['view']>[]>();
    for (const f of files) {
      const list = out.get(f.campaignId!) ?? [];
      list.push(this.view(f));
      out.set(f.campaignId!, list);
    }
    return out;
  }

  /** Removes the files nobody attached within a day. */
  async purgeOrphans(now = new Date()) {
    const old = await this.prisma.campaignFile.findMany({
      where: {
        campaignId: null,
        createdAt: { lt: new Date(now.getTime() - ORPHAN_AFTER_MS) },
      },
      take: 500,
    });
    for (const f of old) {
      await this.prisma.campaignFile.delete({ where: { id: f.id } });
      await this.storage.remove(f.key);
    }
    return old.length;
  }

  async open(id: string, exp: string, sig: string) {
    if (!this.verify(id, exp, sig)) throw new NotFoundException();
    const file = await this.prisma.campaignFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException();
    return { file, body: await this.storage.get(file.key) };
  }

  view(f: CampaignFile, now = Date.now()) {
    return {
      id: f.id,
      purpose: f.purpose,
      kind: f.kind,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      url: this.signedUrl(f.id, now),
    };
  }

  // Expires on a 6-hour grid so browsers and the app can cache it.
  private signedUrl(id: string, now: number) {
    const exp = Math.ceil((now + LINK_TTL_MS) / LINK_TTL_MS) * LINK_TTL_MS;
    return `${this.publicUrl}/files/campaign/${id}?exp=${exp}&sig=${this.sign(id, exp)}`;
  }

  private verify(id: string, exp: string, sig: string) {
    const expires = Number(exp);
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    const expected = Buffer.from(this.sign(id, expires));
    const given = Buffer.from(sig ?? '');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private sign(id: string, exp: number) {
    return createHmac('sha256', this.secret)
      .update(`campaign-file:${id}:${exp}`)
      .digest('base64url');
  }
}

// Multer reads the name as Latin-1; keep a readable, short name.
function fileName(original: string | undefined, ext: string) {
  const name = Buffer.from(original ?? '', 'latin1')
    .toString('utf8')
    .replace(/[\\/\0\r\n]/g, '')
    .trim()
    .slice(0, 120);
  return name || `fichier.${ext}`;
}
