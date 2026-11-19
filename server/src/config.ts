import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface AppConfig {
  port: number;
  nodeEnv: string;
  jwtSecret: string;
  founderUsername: string;
  dbPath: string;
  uploadDir: string;
  corsOrigins: string[];
  messageTtlMs: number;
  storyTtlMs: number;
  activeThresholdMs: number;
  disableRateLimit?: boolean;
}

const DEFAULT_DEV_SECRET = crypto.randomBytes(32).toString('hex');

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const envSecret = process.env.JWT_SECRET;

  if (nodeEnv === 'production' && (!envSecret || envSecret.length < 32) && !overrides.jwtSecret) {
    throw new Error('FATAL: JWT_SECRET must be set to at least 32 characters in production.');
  }

  const rawFounder = (overrides.founderUsername ?? process.env.FOUNDER_USERNAME ?? 'abhishek')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

  const rawCors = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [
        'http://localhost:5173',
        'http://localhost:4173',
        'http://localhost:4000',
        'http://127.0.0.1:5173',
        'capacitor://localhost',
        'https://localhost',
        'http://localhost',
      ];

  return {
    port: overrides.port ?? Number(process.env.PORT ?? 4000),
    nodeEnv,
    jwtSecret: overrides.jwtSecret ?? envSecret ?? DEFAULT_DEV_SECRET,
    founderUsername: rawFounder || 'abhishek',
    dbPath: overrides.dbPath ?? process.env.DB_PATH ?? path.join(SERVER_ROOT, 'data/mono.db'),
    uploadDir: overrides.uploadDir ?? process.env.UPLOAD_DIR ?? path.join(SERVER_ROOT, 'uploads'),
    corsOrigins: overrides.corsOrigins ?? rawCors,
    messageTtlMs: overrides.messageTtlMs ?? 30 * 24 * 60 * 60 * 1000, // Exactly 30 days
    storyTtlMs: overrides.storyTtlMs ?? 24 * 60 * 60 * 1000, // Exactly 24 hours
    activeThresholdMs: overrides.activeThresholdMs ?? 2 * 60 * 1000, // 2 minutes
    disableRateLimit: overrides.disableRateLimit ?? false,
  };
}
