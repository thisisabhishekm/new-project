import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export interface TokenPayload {
  sub: string;
  username: string;
  jti: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

export function signToken(
  userId: string,
  username: string,
  secret: string,
  ttlSeconds = 7 * 24 * 60 * 60
): { token: string; jti: string; expMs: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: TokenPayload = {
    sub: userId,
    username,
    jti,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${header}.${encodedPayload}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return {
    token: `${data}.${base64UrlEncode(sig)}`,
    jti,
    expMs: payload.exp * 1000,
  };
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  try {
    const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as {
      alg?: string;
      typ?: string;
    };
    // Strictly reject alg:none or any non-HS256 algorithm
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    const data = `${headerB64}.${payloadB64}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest();
    const providedSig = base64UrlDecode(sigB64);

    if (providedSig.length !== expectedSig.length) {
      return null;
    }
    if (!crypto.timingSafeEqual(providedSig, expectedSig)) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as TokenPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.username !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= nowSec
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export interface ValidatedImage {
  ext: 'jpg' | 'png' | 'webp' | 'gif';
  mime: string;
}

/**
 * Validates raw file bytes by inspecting exact magic headers.
 * Prevents extension spoofing, SVG XSS uploads, and HTML/script polyglots.
 */
export function validateImageBuffer(buf: Buffer): ValidatedImage | null {
  if (!buf || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }

  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }

  // GIF: GIF87a or GIF89a
  const gifHeader = buf.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { ext: 'gif', mime: 'image/gif' };
  }

  return null;
}

/**
 * Strips invisible control characters (except newlines/tabs) and trims text safely.
 */
export function cleanText(input: string, maxLength: number): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function extractHashtags(text: string): string[] {
  const matches = text.match(/#([a-zA-Z0-9_]{1,40})/g) ?? [];
  const unique = new Set(matches.map((m) => m.slice(1).toLowerCase()));
  return [...unique].slice(0, 15);
}

export function extractMentions(text: string): string[] {
  const matches = text.match(/@([a-zA-Z0-9_.]{2,30})/g) ?? [];
  const unique = new Set(matches.map((m) => m.slice(1).toLowerCase()));
  return [...unique].slice(0, 15);
}
