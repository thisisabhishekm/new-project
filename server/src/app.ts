import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { loadConfig, type AppConfig } from './config.js';
import { initDatabase, purgeExpiredData } from './db.js';
import {
  cleanText,
  extractHashtags,
  hashPassword,
  signToken,
  validateImageBuffer,
  verifyPassword,
  verifyToken,
} from './security.js';
import { computeBillSplits, simplifyGroupDebts } from './bills.js';
import { seedIfEmpty } from './seed.js';

interface DbUserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  password_hash: string;
  bio: string;
  avatar_url: string;
  show_activity_status: number;
  last_active_at: number;
  created_at: number;
}

interface AuthedRequest extends Request {
  auth?: {
    user: DbUserRow;
    jti: string;
    expMs: number;
  };
}

export interface MonoAppInstance {
  app: express.Express;
  db: DatabaseSync;
  config: AppConfig;
  close: () => void;
}

const USERNAME_REGEX = /^[a-z0-9_.]{3,24}$/;
const CURRENCY_CODES = ['USD', 'INR', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'] as const;

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_REGEX, 'Username must be 3-24 characters using lowercase letters, numbers, dots, or underscores.'),
  displayName: z.string().trim().min(1, 'Display name is required.').max(50),
  email: z.string().trim().toLowerCase().email('Please provide a valid email address.').max(120),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(128)
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must include both letters and numbers.'),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Username or email is required.').max(120),
  password: z.string().min(1, 'Password is required.').max(128),
});

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  bio: z.string().max(180).optional(),
  avatarUrl: z
    .string()
    .max(300)
    .refine((v) => v === '' || v.startsWith('/uploads/'), 'Avatar must be a valid uploaded image.')
    .optional(),
  showActivityStatus: z.boolean().optional(),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
});

const createPostSchema = z.object({
  imageUrl: z
    .string()
    .min(1)
    .max(300)
    .refine((v) => v.startsWith('/uploads/'), 'Post image must be an uploaded photo.'),
  caption: z.string().max(1000).optional().default(''),
  locationName: z.string().max(80).optional().default(''),
  locationCity: z.string().max(80).optional().default(''),
  filterStyle: z.enum(['mono', 'noir', 'silver', 'raw']).optional().default('mono'),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).optional().default([]),
  taggedUsers: z
    .array(
      z.object({
        username: z.string().trim().toLowerCase().min(2).max(24),
        posX: z.number().min(5).max(95).optional().default(50),
        posY: z.number().min(5).max(95).optional().default(50),
      })
    )
    .max(10)
    .optional()
    .default([]),
});

const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty.').max(400),
});

const createStorySchema = z
  .object({
    mediaUrl: z
      .string()
      .max(300)
      .refine((v) => v === '' || v.startsWith('/uploads/'), 'Story media must be an uploaded photo.')
      .optional()
      .default(''),
    textContent: z.string().max(240).optional().default(''),
    bgStyle: z.enum(['noir', 'paper', 'slate']).optional().default('noir'),
    locationName: z.string().max(80).optional().default(''),
    taggedUsernames: z.array(z.string().trim().toLowerCase().min(2).max(24)).max(8).optional().default([]),
  })
  .refine((d) => d.mediaUrl.length > 0 || d.textContent.trim().length > 0, {
    message: 'Story requires either a photo or text.',
  });

const createDmSchema = z.object({
  username: z.string().trim().toLowerCase().min(2).max(24),
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required.').max(60),
  description: z.string().max(160).optional().default(''),
  memberUsernames: z.array(z.string().trim().toLowerCase().min(2).max(24)).max(25).optional().default([]),
});

const addGroupMemberSchema = z.object({
  username: z.string().trim().toLowerCase().min(2).max(24),
});

const createMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty.').max(2000),
});

const createBillSchema = z.object({
  title: z.string().trim().min(1, 'Bill title is required.').max(80),
  totalCents: z.number().int().positive('Total must be greater than zero.').max(100_000_000),
  currency: z.enum(CURRENCY_CODES).optional().default('USD'),
  paidByUserId: z.string().min(1).optional(),
  splitType: z.enum(['equal', 'exact', 'percentage']).default('equal'),
  participantIds: z.array(z.string().min(1)).min(1).max(30),
  exactCents: z.record(z.string(), z.number().int().min(0)).optional(),
  percentages: z.record(z.string(), z.number().min(0).max(100)).optional(),
  notes: z.string().max(240).optional().default(''),
});

const createReportSchema = z.object({
  targetType: z.enum(['post', 'comment', 'story', 'user', 'message']),
  targetId: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(3).max(300),
});

function serializeUser(
  user: DbUserRow,
  viewer: DbUserRow | null,
  config: AppConfig,
  includePrivate = false
) {
  const now = Date.now();
  const isSelf = viewer ? viewer.id === user.id : false;
  const canSeeActivity =
    isSelf ||
    (viewer !== null &&
      viewer.show_activity_status === 1 &&
      user.show_activity_status === 1);

  const isActive = canSeeActivity && now - user.last_active_at <= config.activeThresholdMs;

  // CRITICAL INVARIANT:
  // 1. Only the founder account ever gets the blue tick (computed strictly from server config).
  // 2. Follower & following counts/lists are NEVER included anywhere in any user payload.
  const base = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio,
    avatarUrl: user.avatar_url,
    hasBlueTick: user.username.toLowerCase() === config.founderUsername,
    isActive,
    lastSeenAt: canSeeActivity ? user.last_active_at : null,
    createdAt: user.created_at,
  };

  if (includePrivate && isSelf) {
    return {
      ...base,
      email: user.email,
      showActivityStatus: user.show_activity_status === 1,
    };
  }
  return base;
}

export function createApp(
  overrides: Partial<AppConfig> = {},
  options: { seed?: boolean; startPurgeTimer?: boolean } = {}
): MonoAppInstance {
  const config = loadConfig(overrides);
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const db = initDatabase(config.dbPath);

  if (options.seed !== false) {
    seedIfEmpty(db, config);
  }
  purgeExpiredData(db);

  let purgeTimer: NodeJS.Timeout | null = null;
  if (options.startPurgeTimer !== false) {
    purgeTimer = setInterval(() => {
      try {
        purgeExpiredData(db);
      } catch {
        // Keep server resilient if DB is closing
      }
    }, 5 * 60 * 1000);
    purgeTimer.unref();
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin not permitted by CORS policy'));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '256kb' }));

  // Rate limiters
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.disableRateLimit ? 10_000 : 25,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again shortly.' },
  });

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.disableRateLimit ? 10_000 : 400,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Please slow down.' },
  });

  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.disableRateLimit ? 10_000 : 40,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Upload rate limit exceeded. Please try again later.' },
  });

  app.use('/api', apiLimiter);

  // Serve validated uploaded images safely with nosniff
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      next();
    },
    express.static(config.uploadDir, {
      dotfiles: 'deny',
      index: false,
      fallthrough: false,
    })
  );

  // Auth middleware
  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    const payload = verifyToken(token, config.jwtSecret);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired session.' });
      return;
    }

    const revoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(payload.jti);
    if (revoked) {
      res.status(401).json({ error: 'Session has been revoked.' });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as
      | DbUserRow
      | undefined;
    if (!user) {
      res.status(401).json({ error: 'Account no longer exists.' });
      return;
    }

    // Update last active timestamp quietly
    const now = Date.now();
    if (now - user.last_active_at > 15_000) {
      db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, user.id);
      user.last_active_at = now;
    }

    req.auth = { user, jti: payload.jti, expMs: payload.exp * 1000 };
    next();
  };

  function isBlockedBetween(userA: string, userB: string): boolean {
    const row = db
      .prepare(
        'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
      )
      .get(userA, userB, userB, userA);
    return Boolean(row);
  }

  function getBlockedUserIds(viewerId: string): Set<string> {
    const rows = db
      .prepare('SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = ? OR blocked_id = ?')
      .all(viewerId, viewerId) as Array<{ blocker_id: string; blocked_id: string }>;
    const set = new Set<string>();
    for (const r of rows) {
      if (r.blocker_id !== viewerId) set.add(r.blocker_id);
      if (r.blocked_id !== viewerId) set.add(r.blocked_id);
    }
    return set;
  }

  function hydratePosts(postRows: Array<Record<string, unknown>>, viewer: DbUserRow) {
    if (postRows.length === 0) return [];
    const blocked = getBlockedUserIds(viewer.id);

    return postRows
      .filter((p) => !blocked.has(String(p.author_id)))
      .map((p) => {
        const postId = String(p.id);
        const author = db
          .prepare('SELECT * FROM users WHERE id = ?')
          .get(String(p.author_id)) as unknown as DbUserRow;
        const tags = (
          db.prepare('SELECT tag FROM post_tags WHERE post_id = ? ORDER BY tag ASC').all(postId) as Array<{
            tag: string;
          }>
        ).map((t) => t.tag);

        const taggedUsers = (
          db
            .prepare(
              `SELECT u.id, u.username, u.display_name, put.pos_x, put.pos_y
               FROM post_user_tags put
               JOIN users u ON u.id = put.tagged_user_id
               WHERE put.post_id = ?`
            )
            .all(postId) as Array<{
            id: string;
            username: string;
            display_name: string;
            pos_x: number;
            pos_y: number;
          }>
        ).map((tu) => ({
          id: tu.id,
          username: tu.username,
          displayName: tu.display_name,
          hasBlueTick: tu.username.toLowerCase() === config.founderUsername,
          posX: tu.pos_x,
          posY: tu.pos_y,
        }));

        const likeRow = db
          .prepare('SELECT COUNT(*) as cnt FROM post_likes WHERE post_id = ?')
          .get(postId) as { cnt: number };
        const isLiked = Boolean(
          db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, viewer.id)
        );
        const isSaved = Boolean(
          db.prepare('SELECT 1 FROM post_saves WHERE post_id = ? AND user_id = ?').get(postId, viewer.id)
        );

        const safeComments = (
          db
            .prepare(
              `SELECT c.id as comment_id, c.body as comment_body, c.created_at as comment_created_at,
                      u.id, u.username, u.display_name, u.email, u.password_hash, u.bio, u.avatar_url,
                      u.show_activity_status, u.last_active_at, u.created_at
               FROM post_comments c
               JOIN users u ON u.id = c.author_id
               WHERE c.post_id = ?
               ORDER BY c.created_at ASC`
            )
            .all(postId) as unknown as Array<
            DbUserRow & { comment_id: string; comment_body: string; comment_created_at: number }
          >
        )
          .filter((c) => !blocked.has(c.id))
          .map((c) => ({
            id: c.comment_id,
            body: c.comment_body,
            createdAt: c.comment_created_at,
            author: serializeUser(c, viewer, config),
          }));

        return {
          id: postId,
          imageUrl: String(p.image_url),
          caption: String(p.caption),
          locationName: String(p.location_name),
          locationCity: String(p.location_city),
          filterStyle: String(p.filter_style),
          createdAt: Number(p.created_at),
          author: serializeUser(author, viewer, config),
          tags,
          taggedUsers,
          likeCount: Number(likeRow.cnt),
          isLiked,
          isSaved,
          comments: safeComments,
        };
      });
  }

  // ==================== HEALTH & META ====================
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: 'MONO',
      policy: {
        reelsEnabled: false,
        followerListsVisible: false,
        messageRetentionDays: Math.round(config.messageTtlMs / (24 * 60 * 60 * 1000)),
        storyRetentionHours: Math.round(config.storyTtlMs / (60 * 60 * 1000)),
      },
    });
  });

  // Explicitly block Reels (by design)
  app.all('/api/reels', (_req, res) => {
    res.status(404).json({ error: 'Reels are intentionally not supported on MONO.' });
  });
  app.all('/api/reels/*splat', (_req, res) => {
    res.status(404).json({ error: 'Reels are intentionally not supported on MONO.' });
  });

  // ==================== AUTH ====================
  app.post('/api/auth/register', authLimiter, (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' });
      return;
    }

    const { username, displayName, email, password } = parsed.data;
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .get(username, email);
    if (existing) {
      res.status(409).json({ error: 'Username or email is already registered.' });
      return;
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    const passwordHash = hashPassword(password);

    db.prepare(
      `INSERT INTO users (id, username, display_name, email, password_hash, bio, avatar_url, show_activity_status, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, '', '', 1, ?, ?)`
    ).run(id, username, cleanText(displayName, 50), email, passwordHash, now, now);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as DbUserRow;
    const { token } = signToken(user.id, user.username, config.jwtSecret);

    res.status(201).json({
      token,
      user: serializeUser(user, user, config, true),
    });
  });

  app.post('/api/auth/login', authLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid credentials.' });
      return;
    }

    const identifier = parsed.data.identifier.toLowerCase().replace(/^@/, '');
    const user = db
      .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
      .get(identifier, identifier) as DbUserRow | undefined;

    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid username/email or password.' });
      return;
    }

    const now = Date.now();
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, user.id);
    user.last_active_at = now;

    const { token } = signToken(user.id, user.username, config.jwtSecret);
    res.json({
      token,
      user: serializeUser(user, user, config, true),
    });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
    const { jti, expMs } = req.auth!;
    db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, expMs);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.auth!.user;
    res.json({
      user: serializeUser(user, user, config, true),
      policy: {
        reelsEnabled: false,
        followerListsVisible: false,
        messageRetentionDays: Math.round(config.messageTtlMs / (24 * 60 * 60 * 1000)),
        storyRetentionHours: Math.round(config.storyTtlMs / (60 * 60 * 1000)),
      },
    });
  });

  app.post('/api/presence/ping', requireAuth, (req: AuthedRequest, res) => {
    const now = Date.now();
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, req.auth!.user.id);
    res.json({ ok: true, lastActiveAt: now });
  });

  // ==================== USERS & PRIVACY ====================
  // Explicitly refuse any attempt to list anyone's followers or following
  app.get('/api/users/:username/followers', requireAuth, (_req, res) => {
    res.status(403).json({
      error: 'Follower lists are strictly private on MONO and cannot be viewed by anyone.',
    });
  });

  app.get('/api/users/:username/following', requireAuth, (_req, res) => {
    res.status(403).json({
      error: 'Following lists are strictly private on MONO and cannot be viewed by anyone.',
    });
  });

  app.patch('/api/users/me', requireAuth, (req: AuthedRequest, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile update.' });
      return;
    }

    const viewer = req.auth!.user;
    const displayName =
      parsed.data.displayName !== undefined
        ? cleanText(parsed.data.displayName, 50)
        : viewer.display_name;
    const bio = parsed.data.bio !== undefined ? cleanText(parsed.data.bio, 180) : viewer.bio;
    const avatarUrl = parsed.data.avatarUrl !== undefined ? parsed.data.avatarUrl : viewer.avatar_url;
    const showActivity =
      parsed.data.showActivityStatus !== undefined
        ? parsed.data.showActivityStatus
          ? 1
          : 0
        : viewer.show_activity_status;

    db.prepare(
      'UPDATE users SET display_name = ?, bio = ?, avatar_url = ?, show_activity_status = ? WHERE id = ?'
    ).run(displayName, bio, avatarUrl, showActivity, viewer.id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(viewer.id) as unknown as DbUserRow;
    res.json({ user: serializeUser(updated, updated, config, true) });
  });

  app.delete('/api/users/me', requireAuth, (req: AuthedRequest, res) => {
    const parsed = deleteAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Password confirmation is required to delete your account.' });
      return;
    }

    const { user, jti, expMs } = req.auth!;
    if (!verifyPassword(parsed.data.password, user.password_hash)) {
      res.status(401).json({ error: 'Incorrect password.' });
      return;
    }

    db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, expMs);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    res.json({ deleted: true });
  });

  app.get('/api/users/search', requireAuth, (req: AuthedRequest, res) => {
    const viewer = req.auth!.user;
    const q = String(req.query.q ?? '').trim().toLowerCase().replace(/^@/, '');
    const blocked = getBlockedUserIds(viewer.id);

    const rows = (
      q
        ? db
            .prepare(
              `SELECT * FROM users
               WHERE lower(username) LIKE ? OR lower(display_name) LIKE ?
               ORDER BY username ASC
               LIMIT 25`
            )
            .all(`%${q}%`, `%${q}%`)
        : db.prepare('SELECT * FROM users ORDER BY last_active_at DESC LIMIT 20').all()
    ) as unknown as DbUserRow[];

    const users = rows
      .filter((u) => !blocked.has(u.id))
      .map((u) => {
        const isFollowing = Boolean(
          db
            .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
            .get(viewer.id, u.id)
        );
        return {
          ...serializeUser(u, viewer, config),
          isFollowing: u.id === viewer.id ? false : isFollowing,
        };
      });

    res.json({ users });
  });

  app.get('/api/users/:username', requireAuth, (req: AuthedRequest, res) => {
    const viewer = req.auth!.user;
    const username = String(req.params.username).trim().toLowerCase().replace(/^@/, '');
    const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | DbUserRow
      | undefined;

    if (!target || isBlockedBetween(viewer.id, target.id)) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const isFollowing =
      target.id !== viewer.id &&
      Boolean(
        db
          .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
          .get(viewer.id, target.id)
      );

    const postRows = db
      .prepare('SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 60')
      .all(target.id) as Array<Record<string, unknown>>;

    res.json({
      user: {
        ...serializeUser(target, viewer, config, target.id === viewer.id),
        isFollowing,
        postCount: postRows.length,
        // Explicitly NO followerCount, followingCount, followers, or following!
      },
      posts: hydratePosts(postRows, viewer),
    });
  });

  app.post('/api/users/:username/follow', requireAuth, (req: AuthedRequest, res) => {
    const viewer = req.auth!.user;
    const username = String(req.params.username).trim().toLowerCase().replace(/^@/, '');
    const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | DbUserRow
      | undefined;

    if (!target || isBlockedBetween(viewer.id, target.id)) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    if (target.id === viewer.id) {
      res.status(400).json({ error: 'You cannot follow yourself.' });
      return;
    }

    const existing = db
      .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
      .get(viewer.id, target.id);

    if (existing) {
      db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(
        viewer.id,
        target.id
      );
      res.json({ isFollowing: false });
    } else {
      db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').run(
        viewer.id,
        target.id,
        Date.now()
      );
      res.json({ isFollowing: true });
    }
  });

  app.post('/api/users/:username/block', requireAuth, (req: AuthedRequest, res) => {
    const viewer = req.auth!.user;
    const username = String(req.params.username).trim().toLowerCase().replace(/^@/, '');
    const target = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | DbUserRow
      | undefined;

    if (!target || target.id === viewer.id) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const existing = db
      .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
      .get(viewer.id, target.id);

    if (existing) {
      db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(
        viewer.id,
        target.id
      );
      res.json({ blocked: false });
    } else {
      db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
        viewer.id,
        target.id,
        Date.now()
      );
      // Remove mutual follows automatically when blocking
      db.prepare(
        'DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)'
      ).run(viewer.id, target.id, target.id, viewer.id);
      res.json({ blocked: true });
    }
  });

  app.post('/api/reports', requireAuth, (req: AuthedRequest, res) => {
    const parsed = createReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid report.' });
      return;
    }
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      req.auth!.user.id,
      parsed.data.targetType,
      parsed.data.targetId,
      cleanText(parsed.data.reason, 300),
      Date.now()
    );
    res.status(201).json({ reported: true, id });
  });

  // ==================== UPLOADS (STRICT MAGIC-BYTE PHOTO VALIDATION) ====================
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB max
      files: 1,
    },
  });

  app.post(
    '/api/uploads',
    requireAuth,
    uploadLimiter,
    (req: AuthedRequest, res: Response) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed.';
          res.status(400).json({ error: msg });
          return;
        }
        const file = req.file;
        if (!file || !file.buffer) {
          res.status(400).json({ error: 'Please attach an image file.' });
          return;
        }

        const validated = validateImageBuffer(file.buffer);
        if (!validated) {
          res.status(400).json({
            error: 'Unsupported or unsafe file format. Only valid JPEG, PNG, WebP, or GIF photos are allowed (no videos, reels, or SVGs).',
          });
          return;
        }

        const filename = `${crypto.randomUUID()}.${validated.ext}`;
        const dest = path.join(config.uploadDir, filename);
        fs.writeFileSync(dest, file.buffer, { mode: 0o644 });

        res.status(201).json({
          url: `/uploads/${filename}`,
          mime: validated.mime,
          size: file.buffer.length,
        });
      });
    }
  );

  // ==================== POSTS (PHOTOS, TAGS, LOCATIONS — ZERO REELS) ====================
  app.get('/api/posts/feed', requireAuth, (req: AuthedRequest, res) => {
    const viewer = req.auth!.user;
    const rows = db
      .prepare(
        `SELECT p.* FROM posts p
         WHERE p.author_id = ?
            OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
         ORDER BY p.created_at DESC
         LIMIT 50`
      )
      .all(viewer.id, viewer.id) as Array<Record<string, unknown>>;

    res.json({ posts: hydratePosts(rows, viewer) });
  });

  app.get('/api/posts/explore', requireAuth, (req: AuthedRequest, res) => {
    const viewer = req.auth!.user;
    const tag = String(req.query.tag ?? '').trim().toLowerCase().replace(/^#/, '');
    const location = String(req.query.location ?? '').trim().toLowerCase();
    const q = String(req.query.q ?? '').trim().toLowerCase();

    let rows: Array<Record<string, unknown>>;
    if (tag) {
      rows = db
        .prepare(
          `SELECT p.* FROM posts p
           JOIN post_tags pt ON pt.post_id = p.id
           WHERE pt.tag = ?
           ORDER BY p.created_at DESC
           LIMIT 50`
        )
        .all(tag) as Array<Record<string, unknown>>;
    } else if (location) {
      rows = db
        .prepare(
          `SELECT * FROM posts
           WHERE lower(location_name) LIKE ? OR lower(location_city) LIKE ?
           ORDER BY created_at DESC
           LIMIT 50`
        )
        .all(`%${location}%`, `%${location}%`) as Array<Record<string, unknown>>;
    } else if (q) {
      rows = db
        .prepare(
          `SELECT DISTINCT p.* FROM posts p
           LEFT JOIN post_tags pt ON pt.post_id = p.id
           WHERE lower(p.caption) LIKE ?
              OR lower(p.location_name) LIKE ?
              OR lower(p.location_city) LIKE ?
              OR lower(pt.tag) LIKE ?
           ORDER BY p.created_at DESC
           LIMIT 50`
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`) as Array<Record<string, unknown>>;
    } else {
      rows = db
        .prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 50')
        .all() as Array<Record<string, unknown>>;
    }

    res.json({ posts: hydratePosts(rows, viewer) });
  });

  app.get('/api/posts/saved', requireAuth, (req: AuthedRequest, res) => {
    const viewer = req.auth!.user;
    const rows = db
      .prepare(
        `SELECT p.* FROM posts p
         JOIN post_saves ps ON ps.post_id = p.id
         WHERE ps.user_id = ?
         ORDER BY ps.created_at DESC
         LIMIT 50`
      )
      .all(viewer.id) as Array<Record<string, unknown>>;

    res.json({ posts: hydratePosts(rows, viewer) });
  });

  app.post('/api/posts', requireAuth, (req: AuthedRequest, res) => {
    const parsed = createPostSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid post data.' });
      return;
    }

    const viewer = req.auth!.user;
    const data = parsed.data;
    const id = crypto.randomUUID();
    const now = Date.now();
    const cleanCaption = cleanText(data.caption, 1000);

    db.prepare(
      `INSERT INTO posts (id, author_id, image_url, caption, location_name, location_city, filter_style, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      viewer.id,
      data.imageUrl,
      cleanCaption,
      cleanText(data.locationName, 80),
      cleanText(data.locationCity, 80),
      data.filterStyle,
      now
    );

    const combinedTags = new Set([
      ...extractHashtags(cleanCaption),
      ...data.tags.map((t) => t.toLowerCase().replace(/^#/, '')).filter(Boolean),
    ]);
    const insertTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)');
    for (const tag of [...combinedTags].slice(0, 15)) {
      insertTag.run(id, tag);
    }

    const insertUserTag = db.prepare(
      'INSERT OR IGNORE INTO post_user_tags (post_id, tagged_user_id, pos_x, pos_y) VALUES (?, ?, ?, ?)'
    );
    for (const tu of data.taggedUsers) {
      const target = db.prepare('SELECT id FROM users WHERE username = ?').get(tu.username) as
        | { id: string }
        | undefined;
      if (target && !isBlockedBetween(viewer.id, target.id)) {
        insertUserTag.run(id, target.id, tu.posX, tu.posY);
      }
    }

    const created = db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json({ post: hydratePosts([created], viewer)[0] });
  });

  app.delete('/api/posts/:id', requireAuth, (req: AuthedRequest, res) => {
    const post = db.prepare('SELECT author_id FROM posts WHERE id = ?').get(String(req.params.id)) as
      | { author_id: string }
      | undefined;
    if (!post) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    if (post.author_id !== req.auth!.user.id) {
      res.status(403).json({ error: 'You can only delete your own posts.' });
      return;
    }
    db.prepare('DELETE FROM posts WHERE id = ?').run(String(req.params.id));
    res.json({ deleted: true });
  });

  app.post('/api/posts/:id/like', requireAuth, (req: AuthedRequest, res) => {
    const postId = String(req.params.id);
    const exists = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
    if (!exists) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    const viewerId = req.auth!.user.id;
    const liked = db
      .prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?')
      .get(postId, viewerId);

    if (liked) {
      db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, viewerId);
    } else {
      db.prepare('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run(
        postId,
        viewerId,
        Date.now()
      );
    }
    const cnt = db.prepare('SELECT COUNT(*) as cnt FROM post_likes WHERE post_id = ?').get(postId) as {
      cnt: number;
    };
    res.json({ isLiked: !liked, likeCount: Number(cnt.cnt) });
  });

  app.post('/api/posts/:id/save', requireAuth, (req: AuthedRequest, res) => {
    const postId = String(req.params.id);
    const exists = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
    if (!exists) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    const viewerId = req.auth!.user.id;
    const saved = db
      .prepare('SELECT 1 FROM post_saves WHERE post_id = ? AND user_id = ?')
      .get(postId, viewerId);

    if (saved) {
      db.prepare('DELETE FROM post_saves WHERE post_id = ? AND user_id = ?').run(postId, viewerId);
      res.json({ isSaved: false });
    } else {
      db.prepare('INSERT INTO post_saves (post_id, user_id, created_at) VALUES (?, ?, ?)').run(
        postId,
        viewerId,
        Date.now()
      );
      res.json({ isSaved: true });
    }
  });

  app.post('/api/posts/:id/comments', requireAuth, (req: AuthedRequest, res) => {
    const postId = String(req.params.id);
    const exists = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
    if (!exists) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid comment.' });
      return;
    }

    const viewer = req.auth!.user;
    const id = crypto.randomUUID();
    const now = Date.now();
    const body = cleanText(parsed.data.body, 400);

    db.prepare(
      'INSERT INTO post_comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, postId, viewer.id, body, now);

    res.status(201).json({
      comment: {
        id,
        body,
        createdAt: now,
        author: serializeUser(viewer, viewer, config),
      },
    });
  });

  app.delete('/api/comments/:id', requireAuth, (req: AuthedRequest, res) => {
    const commentId = String(req.params.id);
    const row = db
      .prepare(
        `SELECT c.author_id as comment_author, p.author_id as post_author
         FROM post_comments c
         JOIN posts p ON p.id = c.post_id
         WHERE c.id = ?`
      )
      .get(commentId) as { comment_author: string; post_author: string } | undefined;

    if (!row) {
      res.status(404).json({ error: 'Comment not found.' });
      return;
    }
    const viewerId = req.auth!.user.id;
    if (row.comment_author !== viewerId && row.post_author !== viewerId) {
      res.status(403).json({ error: 'Not authorized to delete this comment.' });
      return;
    }

    db.prepare('DELETE FROM post_comments WHERE id = ?').run(commentId);
    res.json({ deleted: true });
  });

  // ==================== STORIES (24-HOUR EPHEMERAL) ====================
  app.get('/api/stories', requireAuth, (req: AuthedRequest, res) => {
    const now = Date.now();
    purgeExpiredData(db, now);

    const viewer = req.auth!.user;
    const blocked = getBlockedUserIds(viewer.id);

    const rows = db
      .prepare(
        `SELECT * FROM stories
         WHERE expires_at > ?
           AND (author_id = ? OR author_id IN (SELECT following_id FROM follows WHERE follower_id = ?))
         ORDER BY created_at ASC`
      )
      .all(now, viewer.id, viewer.id) as Array<{
      id: string;
      author_id: string;
      media_url: string;
      text_content: string;
      bg_style: string;
      location_name: string;
      tagged_usernames: string;
      created_at: number;
      expires_at: number;
    }>;

    const grouped = new Map<
      string,
      {
        author: ReturnType<typeof serializeUser>;
        hasUnseen: boolean;
        stories: Array<Record<string, unknown>>;
      }
    >();

    for (const s of rows) {
      if (blocked.has(s.author_id)) continue;
      const authorRow = db.prepare('SELECT * FROM users WHERE id = ?').get(s.author_id) as unknown as DbUserRow;
      const isViewed = Boolean(
        db.prepare('SELECT 1 FROM story_views WHERE story_id = ? AND viewer_id = ?').get(s.id, viewer.id)
      );

      let viewers: Array<ReturnType<typeof serializeUser>> | undefined;
      if (s.author_id === viewer.id) {
        const viewerRows = db
          .prepare(
            `SELECT u.* FROM story_views sv
             JOIN users u ON u.id = sv.viewer_id
             WHERE sv.story_id = ? AND sv.viewer_id != ?
             ORDER BY sv.viewed_at DESC`
          )
          .all(s.id, viewer.id) as unknown as DbUserRow[];
        viewers = viewerRows.map((v) => serializeUser(v, viewer, config));
      }

      const item = {
        id: s.id,
        mediaUrl: s.media_url,
        textContent: s.text_content,
        bgStyle: s.bg_style,
        locationName: s.location_name,
        taggedUsernames: JSON.parse(s.tagged_usernames || '[]') as string[],
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        isViewed,
        ...(viewers !== undefined ? { viewers } : {}),
      };

      const existing = grouped.get(s.author_id);
      if (!existing) {
        grouped.set(s.author_id, {
          author: serializeUser(authorRow, viewer, config),
          hasUnseen: s.author_id !== viewer.id && !isViewed,
          stories: [item],
        });
      } else {
        existing.stories.push(item);
        if (s.author_id !== viewer.id && !isViewed) existing.hasUnseen = true;
      }
    }

    // Put current user's own story first if present, then unseen, then seen
    const list = [...grouped.values()].sort((a, b) => {
      if (a.author.id === viewer.id) return -1;
      if (b.author.id === viewer.id) return 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return 0;
    });

    res.json({ storyGroups: list });
  });

  app.post('/api/stories', requireAuth, (req: AuthedRequest, res) => {
    const parsed = createStorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid story.' });
      return;
    }

    const viewer = req.auth!.user;
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + config.storyTtlMs;

    db.prepare(
      `INSERT INTO stories (id, author_id, media_url, text_content, bg_style, location_name, tagged_usernames, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      viewer.id,
      parsed.data.mediaUrl,
      cleanText(parsed.data.textContent, 240),
      parsed.data.bgStyle,
      cleanText(parsed.data.locationName, 80),
      JSON.stringify(parsed.data.taggedUsernames),
      now,
      expiresAt
    );

    res.status(201).json({
      story: {
        id,
        mediaUrl: parsed.data.mediaUrl,
        textContent: cleanText(parsed.data.textContent, 240),
        bgStyle: parsed.data.bgStyle,
        locationName: cleanText(parsed.data.locationName, 80),
        taggedUsernames: parsed.data.taggedUsernames,
        createdAt: now,
        expiresAt,
        author: serializeUser(viewer, viewer, config),
      },
    });
  });

  app.post('/api/stories/:id/view', requireAuth, (req: AuthedRequest, res) => {
    const storyId = String(req.params.id);
    const story = db
      .prepare('SELECT id FROM stories WHERE id = ? AND expires_at > ?')
      .get(storyId, Date.now());
    if (!story) {
      res.status(404).json({ error: 'Story not found or expired.' });
      return;
    }
    db.prepare(
      'INSERT OR IGNORE INTO story_views (story_id, viewer_id, viewed_at) VALUES (?, ?, ?)'
    ).run(storyId, req.auth!.user.id, Date.now());
    res.json({ viewed: true });
  });

  app.delete('/api/stories/:id', requireAuth, (req: AuthedRequest, res) => {
    const storyId = String(req.params.id);
    const story = db.prepare('SELECT author_id FROM stories WHERE id = ?').get(storyId) as
      | { author_id: string }
      | undefined;
    if (!story) {
      res.status(404).json({ error: 'Story not found.' });
      return;
    }
    if (story.author_id !== req.auth!.user.id) {
      res.status(403).json({ error: 'You can only delete your own stories.' });
      return;
    }
    db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
    res.json({ deleted: true });
  });

  // ==================== CONVERSATIONS & 30-DAY AUTO-ERASING MESSAGES ====================
  function assertConversationMember(conversationId: string, userId: string): { role: string; type: string } | null {
    const row = db
      .prepare(
        `SELECT cm.role, c.type
         FROM conversation_members cm
         JOIN conversations c ON c.id = cm.conversation_id
         WHERE cm.conversation_id = ? AND cm.user_id = ?`
      )
      .get(conversationId, userId) as { role: string; type: string } | undefined;
    return row ?? null;
  }

  app.get('/api/conversations', requireAuth, (req: AuthedRequest, res) => {
    const now = Date.now();
    purgeExpiredData(db, now);

    const viewer = req.auth!.user;
    const convRows = db
      .prepare(
        `SELECT c.*
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
         WHERE cm.user_id = ?
         ORDER BY c.created_at DESC`
      )
      .all(viewer.id) as Array<{
      id: string;
      type: 'dm' | 'group';
      name: string;
      description: string;
      created_by: string;
      created_at: number;
    }>;

    const conversations = convRows.map((c) => {
      const memberRows = db
        .prepare(
          `SELECT u.*, cm.role as member_role
           FROM conversation_members cm
           JOIN users u ON u.id = cm.user_id
           WHERE cm.conversation_id = ?`
        )
        .all(c.id) as unknown as Array<DbUserRow & { member_role: string }>;

      const members = memberRows.map((m) => ({
        ...serializeUser(m, viewer, config),
        role: m.member_role,
      }));

      const lastMessage = db
        .prepare(
          `SELECT m.id, m.body, m.message_type, m.created_at, m.expires_at, u.username as sender_username
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = ? AND m.expires_at > ?
           ORDER BY m.created_at DESC
           LIMIT 1`
        )
        .get(c.id, now) as
        | {
            id: string;
            body: string;
            message_type: string;
            created_at: number;
            expires_at: number;
            sender_username: string;
          }
        | undefined;

      const openBillsRow = db
        .prepare(
          `SELECT COUNT(DISTINCT b.id) as cnt
           FROM bills b
           JOIN bill_splits bs ON bs.bill_id = b.id
           WHERE b.conversation_id = ? AND bs.settled = 0 AND bs.user_id != b.paid_by_user_id`
        )
        .get(c.id) as { cnt: number };

      return {
        id: c.id,
        type: c.type,
        name: c.name,
        description: c.description,
        createdAt: c.created_at,
        members,
        openBillsCount: Number(openBillsRow.cnt),
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              body: lastMessage.body,
              messageType: lastMessage.message_type,
              createdAt: lastMessage.created_at,
              expiresAt: lastMessage.expires_at,
              senderUsername: lastMessage.sender_username,
            }
          : null,
      };
    });

    // Sort by most recent activity
    conversations.sort((a, b) => {
      const ta = a.lastMessage?.createdAt ?? a.createdAt;
      const tb = b.lastMessage?.createdAt ?? b.createdAt;
      return tb - ta;
    });

    res.json({ conversations });
  });

  app.post('/api/conversations/dm', requireAuth, (req: AuthedRequest, res) => {
    const parsed = createDmSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid username.' });
      return;
    }

    const viewer = req.auth!.user;
    const target = db.prepare('SELECT * FROM users WHERE username = ?').get(parsed.data.username) as
      | DbUserRow
      | undefined;

    if (!target || target.id === viewer.id || isBlockedBetween(viewer.id, target.id)) {
      res.status(404).json({ error: 'User not available for direct message.' });
      return;
    }

    // Reuse existing DM if one exists
    const existing = db
      .prepare(
        `SELECT c.id FROM conversations c
         JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
         JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
         WHERE c.type = 'dm'
         LIMIT 1`
      )
      .get(viewer.id, target.id) as { id: string } | undefined;

    if (existing) {
      res.json({ conversationId: existing.id, created: false });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      "INSERT INTO conversations (id, type, name, description, created_by, created_at) VALUES (?, 'dm', '', '', ?, ?)"
    ).run(id, viewer.id, now);
    db.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
    ).run(id, viewer.id, now);
    db.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
    ).run(id, target.id, now);

    res.status(201).json({ conversationId: id, created: true });
  });

  app.post('/api/conversations/group', requireAuth, (req: AuthedRequest, res) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid group details.' });
      return;
    }

    const viewer = req.auth!.user;
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      "INSERT INTO conversations (id, type, name, description, created_by, created_at) VALUES (?, 'group', ?, ?, ?, ?)"
    ).run(id, cleanText(parsed.data.name, 60), cleanText(parsed.data.description, 160), viewer.id, now);

    const insertMember = db.prepare(
      'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    );
    insertMember.run(id, viewer.id, 'admin', now);

    for (const uname of parsed.data.memberUsernames) {
      const member = db.prepare('SELECT id FROM users WHERE username = ?').get(uname) as
        | { id: string }
        | undefined;
      if (member && member.id !== viewer.id && !isBlockedBetween(viewer.id, member.id)) {
        insertMember.run(id, member.id, 'member', now);
      }
    }

    res.status(201).json({ conversationId: id });
  });

  app.post('/api/conversations/:id/members', requireAuth, (req: AuthedRequest, res) => {
    const convId = String(req.params.id);
    const viewer = req.auth!.user;
    const membership = assertConversationMember(convId, viewer.id);
    if (!membership || membership.type !== 'group') {
      res.status(403).json({ error: 'Not authorized to manage members of this group.' });
      return;
    }
    if (membership.role !== 'admin') {
      res.status(403).json({ error: 'Only group admins can add members.' });
      return;
    }

    const parsed = addGroupMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid username is required.' });
      return;
    }
    const target = db.prepare('SELECT id FROM users WHERE username = ?').get(parsed.data.username) as
      | { id: string }
      | undefined;
    if (!target || isBlockedBetween(viewer.id, target.id)) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    db.prepare(
      "INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)"
    ).run(convId, target.id, Date.now());
    res.status(201).json({ added: true });
  });

  app.get('/api/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
    const convId = String(req.params.id);
    const viewer = req.auth!.user;
    const membership = assertConversationMember(convId, viewer.id);
    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this conversation.' });
      return;
    }

    const now = Date.now();
    purgeExpiredData(db, now);

    const rows = db
      .prepare(
        `SELECT m.id as msg_id, m.body as msg_body, m.message_type, m.created_at as msg_created_at,
                m.expires_at as msg_expires_at,
                u.id, u.username, u.display_name, u.email, u.password_hash, u.bio, u.avatar_url,
                u.show_activity_status, u.last_active_at, u.created_at
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? AND m.expires_at > ?
         ORDER BY m.created_at ASC
         LIMIT 200`
      )
      .all(convId, now) as unknown as Array<
      DbUserRow & {
        msg_id: string;
        msg_body: string;
        message_type: string;
        msg_created_at: number;
        msg_expires_at: number;
      }
    >;

    const messages = rows.map((r) => ({
      id: r.msg_id,
      body: r.msg_body,
      messageType: r.message_type,
      createdAt: r.msg_created_at,
      expiresAt: r.msg_expires_at,
      daysRemaining: Math.max(0, Math.ceil((r.msg_expires_at - now) / (24 * 60 * 60 * 1000))),
      sender: serializeUser(r, viewer, config),
    }));

    res.json({
      messages,
      retentionPolicy: 'Messages automatically erase after 30 days.',
    });
  });

  app.post('/api/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
    const convId = String(req.params.id);
    const viewer = req.auth!.user;
    const membership = assertConversationMember(convId, viewer.id);
    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this conversation.' });
      return;
    }

    const parsed = createMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid message.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + config.messageTtlMs; // Auto-erases in exactly 30 days
    const body = cleanText(parsed.data.body, 2000);

    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, message_type, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'text', ?, ?)`
    ).run(id, convId, viewer.id, body, now, expiresAt);

    res.status(201).json({
      message: {
        id,
        body,
        messageType: 'text',
        createdAt: now,
        expiresAt,
        daysRemaining: Math.round(config.messageTtlMs / (24 * 60 * 60 * 1000)),
        sender: serializeUser(viewer, viewer, config),
      },
    });
  });

  // ==================== GROUP BILL SPLITTING ====================
  app.get('/api/conversations/:id/bills', requireAuth, (req: AuthedRequest, res) => {
    const convId = String(req.params.id);
    const viewer = req.auth!.user;
    const membership = assertConversationMember(convId, viewer.id);
    if (!membership || membership.type !== 'group') {
      res.status(403).json({ error: 'Bill splitting is only accessible to members of this group.' });
      return;
    }

    const memberRows = db
      .prepare(
        `SELECT u.* FROM conversation_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.conversation_id = ?`
      )
      .all(convId) as unknown as DbUserRow[];

    const memberMap = new Map(memberRows.map((m) => [m.id, serializeUser(m, viewer, config)]));

    const billRows = db
      .prepare('SELECT * FROM bills WHERE conversation_id = ? ORDER BY created_at DESC')
      .all(convId) as Array<{
      id: string;
      conversation_id: string;
      title: string;
      total_cents: number;
      currency: string;
      paid_by_user_id: string;
      split_type: string;
      notes: string;
      created_at: number;
    }>;

    const unsettledForSimplification: Array<{
      paidByUserId: string;
      debtorUserId: string;
      owedCents: number;
    }> = [];

    const bills = billRows.map((b) => {
      const splitRows = db
        .prepare('SELECT * FROM bill_splits WHERE bill_id = ?')
        .all(b.id) as Array<{
        id: string;
        bill_id: string;
        user_id: string;
        owed_cents: number;
        settled: number;
        settled_at: number | null;
      }>;

      const splits = splitRows.map((s) => {
        if (s.settled === 0 && s.user_id !== b.paid_by_user_id) {
          unsettledForSimplification.push({
            paidByUserId: b.paid_by_user_id,
            debtorUserId: s.user_id,
            owedCents: s.owed_cents,
          });
        }
        return {
          id: s.id,
          userId: s.user_id,
          user: memberMap.get(s.user_id) ?? null,
          owedCents: s.owed_cents,
          settled: s.settled === 1,
          settledAt: s.settled_at,
        };
      });

      return {
        id: b.id,
        title: b.title,
        totalCents: b.total_cents,
        currency: b.currency,
        paidByUserId: b.paid_by_user_id,
        paidBy: memberMap.get(b.paid_by_user_id) ?? null,
        splitType: b.split_type,
        notes: b.notes,
        createdAt: b.created_at,
        splits,
      };
    });

    const summary = simplifyGroupDebts(
      memberRows.map((m) => m.id),
      unsettledForSimplification
    );

    res.json({
      bills,
      summary: {
        netBalances: summary.netBalances,
        transfers: summary.transfers.map((t) => ({
          ...t,
          fromUser: memberMap.get(t.fromUserId) ?? null,
          toUser: memberMap.get(t.toUserId) ?? null,
        })),
      },
    });
  });

  app.post('/api/conversations/:id/bills', requireAuth, (req: AuthedRequest, res) => {
    const convId = String(req.params.id);
    const viewer = req.auth!.user;
    const membership = assertConversationMember(convId, viewer.id);
    if (!membership || membership.type !== 'group') {
      res.status(403).json({ error: 'Only group members can create split bills.' });
      return;
    }

    const parsed = createBillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid bill details.' });
      return;
    }

    const data = parsed.data;
    const paidByUserId = data.paidByUserId ?? viewer.id;

    // Verify payer & all participants belong to this group (prevents cross-group IDOR)
    const memberIds = new Set(
      (
        db
          .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
          .all(convId) as Array<{ user_id: string }>
      ).map((r) => r.user_id)
    );

    if (!memberIds.has(paidByUserId)) {
      res.status(400).json({ error: 'Payer must be a member of this group.' });
      return;
    }
    for (const pid of data.participantIds) {
      if (!memberIds.has(pid)) {
        res.status(400).json({ error: 'Every split participant must be a member of this group.' });
        return;
      }
    }

    let computedSplits;
    try {
      computedSplits = computeBillSplits({
        totalCents: data.totalCents,
        splitType: data.splitType,
        participantIds: data.participantIds,
        exactCents: data.exactCents,
        percentages: data.percentages,
      });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid split calculation.' });
      return;
    }

    const billId = crypto.randomUUID();
    const now = Date.now();
    const cleanTitle = cleanText(data.title, 80);
    const cleanNotes = cleanText(data.notes, 240);

    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO bills (id, conversation_id, title, total_cents, currency, paid_by_user_id, split_type, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        billId,
        convId,
        cleanTitle,
        data.totalCents,
        data.currency,
        paidByUserId,
        data.splitType,
        cleanNotes,
        now
      );

      const insertSplit = db.prepare(
        'INSERT INTO bill_splits (id, bill_id, user_id, owed_cents, settled, settled_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const s of computedSplits) {
        const isPayer = s.userId === paidByUserId;
        insertSplit.run(
          crypto.randomUUID(),
          billId,
          s.userId,
          s.owedCents,
          isPayer ? 1 : 0,
          isPayer ? now : null
        );
      }

      // Post a minimalist bill event message to the group chat (respects 30-day auto-erasure!)
      const formattedTotal = `${data.currency} ${(data.totalCents / 100).toFixed(2)}`;
      db.prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, body, message_type, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'bill_event', ?, ?)`
      ).run(
        crypto.randomUUID(),
        convId,
        viewer.id,
        `Added bill "${cleanTitle}" (${formattedTotal}) split ${data.splitType} across ${computedSplits.length} people.`,
        now,
        now + config.messageTtlMs
      );

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({ billId, splits: computedSplits });
  });

  app.post('/api/bills/:billId/splits/:splitId/settle', requireAuth, (req: AuthedRequest, res) => {
    const billId = String(req.params.billId);
    const splitId = String(req.params.splitId);
    const viewer = req.auth!.user;

    const row = db
      .prepare(
        `SELECT bs.id, bs.user_id as debtor_id, bs.owed_cents, bs.settled,
                b.conversation_id, b.paid_by_user_id, b.title, b.currency
         FROM bill_splits bs
         JOIN bills b ON b.id = bs.bill_id
         WHERE bs.id = ? AND bs.bill_id = ?`
      )
      .get(splitId, billId) as
      | {
          id: string;
          debtor_id: string;
          owed_cents: number;
          settled: number;
          conversation_id: string;
          paid_by_user_id: string;
          title: string;
          currency: string;
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Bill split not found.' });
      return;
    }

    const membership = assertConversationMember(row.conversation_id, viewer.id);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group.' });
      return;
    }

    const isAllowed =
      viewer.id === row.debtor_id ||
      viewer.id === row.paid_by_user_id ||
      membership.role === 'admin';
    if (!isAllowed) {
      res.status(403).json({ error: 'Only the debtor, payer, or group admin can settle this split.' });
      return;
    }

    if (row.settled === 1) {
      res.json({ settled: true, alreadySettled: true });
      return;
    }

    const now = Date.now();
    db.prepare('UPDATE bill_splits SET settled = 1, settled_at = ? WHERE id = ?').run(now, splitId);

    const formatted = `${row.currency} ${(row.owed_cents / 100).toFixed(2)}`;
    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, message_type, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'bill_event', ?, ?)`
    ).run(
      crypto.randomUUID(),
      row.conversation_id,
      viewer.id,
      `Settled ${formatted} for "${row.title}".`,
      now,
      now + config.messageTtlMs
    );

    res.json({ settled: true, settledAt: now });
  });

  app.delete('/api/bills/:billId', requireAuth, (req: AuthedRequest, res) => {
    const billId = String(req.params.billId);
    const viewer = req.auth!.user;

    const bill = db
      .prepare('SELECT conversation_id, paid_by_user_id FROM bills WHERE id = ?')
      .get(billId) as { conversation_id: string; paid_by_user_id: string } | undefined;
    if (!bill) {
      res.status(404).json({ error: 'Bill not found.' });
      return;
    }

    const membership = assertConversationMember(bill.conversation_id, viewer.id);
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this group.' });
      return;
    }
    if (bill.paid_by_user_id !== viewer.id && membership.role !== 'admin') {
      res.status(403).json({ error: 'Only the bill payer or group admin can delete this bill.' });
      return;
    }

    db.prepare('DELETE FROM bills WHERE id = ?').run(billId);
    res.json({ deleted: true });
  });

  // Global safe error handler (never leak stack traces in responses)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof Error && err.message.includes('CORS')) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }
    res.status(500).json({ error: 'An unexpected error occurred.' });
  });

  return {
    app,
    db,
    config,
    close: () => {
      if (purgeTimer) clearInterval(purgeTimer);
      db.close();
    },
  };
}
