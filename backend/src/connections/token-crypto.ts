import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/** AES-256-GCM for platform tokens at rest: "iv.tag.data" in base64url. */
export class TokenCrypto {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`tokens:${secret}`).digest();
  }

  encrypt(plain: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data]
      .map((b) => b.toString('base64url'))
      .join('.');
  }

  decrypt(sealed: string) {
    const [iv, tag, data] = sealed
      .split('.')
      .map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }
}
