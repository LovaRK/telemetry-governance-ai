import { createCipheriv, createDecipheriv, randomBytes, CipherKey } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function deriveKey(raw?: string): Buffer {
  const secret = raw || process.env.SPLUNK_SECRET_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      'SPLUNK_SECRET_ENCRYPTION_KEY is not set. Set a 64-char hex key (32 bytes) in environment.'
    );
  }
  const buf = Buffer.from(secret, 'hex');
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `SPLUNK_SECRET_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). Got ${secret.length} chars (${buf.length} bytes).`
    );
  }
  return buf;
}

export function encryptSecret(plaintext: string, key?: string): string {
  const derivedKey = deriveKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, new Uint8Array(derivedKey) as CipherKey, new Uint8Array(iv));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8') as unknown as Uint8Array, cipher.final() as unknown as Uint8Array]);
  const authTag = cipher.getAuthTag();
  return `v1|${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(encoded: string, key?: string): string {
  const derivedKey = deriveKey(key);
  const version = encoded.startsWith('v1|') ? 1 : 0;
  const payload = version === 1 ? encoded.slice(3) : encoded;
  const parts = payload.split(':');
  if (parts.length < 3) {
    throw new Error('FAILED_SECRET_DECRYPTION: invalid stored format (expected iv:tag:cipher)');
  }
  const [ivB64, tagB64, cipherB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(cipherB64, 'base64');
  if (iv.length !== IV_LENGTH) {
    throw new Error('FAILED_SECRET_DECRYPTION: invalid IV length');
  }
  if (authTag.length !== TAG_LENGTH) {
    throw new Error('FAILED_SECRET_DECRYPTION: invalid auth tag length');
  }
  const decipher = createDecipheriv(ALGORITHM, new Uint8Array(derivedKey) as CipherKey, new Uint8Array(iv));
  decipher.setAuthTag(new Uint8Array(authTag));
  try {
    return decipher.update(new Uint8Array(encrypted)) + decipher.final('utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    throw new Error(`FAILED_SECRET_DECRYPTION: ${msg}`);
  }
}

export function reEncryptSecret(encoded: string, newKey?: string): string {
  const plaintext = decryptSecret(encoded);
  return encryptSecret(plaintext, newKey);
}

export function secretVersion(encoded: string): number {
  if (!encoded || typeof encoded !== 'string') return 0;
  if (encoded.startsWith('v1|')) return 1;
  return 0;
}
