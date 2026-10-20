import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

export const MAX_PROOF_BYTES = 8 * 1024 * 1024;

// How long a signed screenshot link works.
const LINK_TTL_MS = 6 * 3600 * 1000;

export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/** The image type, read from the first bytes rather than trusted from the client. */
export function sniffImage(buffer: Buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/**
 * Screenshots sent as proof, kept on the server's disk (a Docker volume in
 * production). Files are only reachable through short-lived signed links.
 */
@Injectable()
export class ProofStorage {
  private readonly dir: string;
  private readonly secret: string;
  private readonly publicUrl: string;

  constructor(config: ConfigService) {
    this.dir = resolve(config.get<string>('UPLOAD_DIR') || './uploads');
    this.secret = config.getOrThrow<string>('JWT_SECRET');
    this.publicUrl = config.get<string>(
      'API_PUBLIC_URL',
      'http://localhost:3001',
    );
  }

  async save(file: UploadedImage | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Ajoute une capture d’écran');
    }
    if (file.size > MAX_PROOF_BYTES) {
      throw new BadRequestException('Capture trop lourde (8 Mo maximum)');
    }
    const type = sniffImage(file.buffer);
    if (!type) {
      throw new BadRequestException('Envoie une image JPEG, PNG ou WebP');
    }
    const key = `proofs/${randomUUID()}.${type.ext}`;
    await mkdir(join(this.dir, 'proofs'), { recursive: true });
    await writeFile(join(this.dir, key), file.buffer);
    return {
      key,
      mimeType: type.mime,
      sizeBytes: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  async read(key: string) {
    if (!/^proofs\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) {
      throw new NotFoundException();
    }
    try {
      return await readFile(join(this.dir, key));
    } catch {
      throw new NotFoundException();
    }
  }

  /** Link for <img> tags and the app; expires on a 6-hour grid so it caches. */
  signedUrl(proofId: string, now = Date.now()) {
    const exp = Math.ceil((now + LINK_TTL_MS) / LINK_TTL_MS) * LINK_TTL_MS;
    return `${this.publicUrl}/files/proofs/${proofId}?exp=${exp}&sig=${this.sign(proofId, exp)}`;
  }

  verify(proofId: string, exp: string, sig: string) {
    const expires = Number(exp);
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    const expected = Buffer.from(this.sign(proofId, expires));
    const given = Buffer.from(sig ?? '');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private sign(proofId: string, exp: number) {
    return createHmac('sha256', this.secret)
      .update(`proof:${proofId}:${exp}`)
      .digest('base64url');
  }
}
