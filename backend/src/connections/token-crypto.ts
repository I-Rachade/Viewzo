import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * AES-256-GCM for platform tokens at rest: "iv.tag.data" in base64url.
 * Encrypts with the current key; also reads tokens sealed with older keys,
 * so the key can change without disconnecting every creator.
 */
export class TokenCrypto {
  private readonly key: Buffer;
  private readonly oldKeys: Buffer[];

  constructor(secret: string, previous: string[] = []) {
    this.key = derive(secret);
    this.oldKeys = previous.filter((p) => p && p !== secret).map(derive);
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
    let lastError: unknown;
    for (const key of [this.key, ...this.oldKeys]) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(data),
          decipher.final(),
        ]).toString('utf8');
      } catch (e) {
        // Wrong key: the authentication tag does not match; try the next.
        lastError = e;
      }
    }
    throw lastError;
  }
}

function derive(secret: string) {
  return createHash('sha256').update(`tokens:${secret}`).digest();
}
