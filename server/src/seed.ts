import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config.js';
import { hashPassword } from './security.js';
import { computeBillSplits } from './bills.js';

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Generates a crisp gallery-style monochrome PNG image locally (zero external URLs, 100% CSP safe).
 */
function generateMonochromePng(
  width: number,
  height: number,
  pixelFn: (x: number, y: number, w: number, h: number) => number
): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width + 1);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(pixelFn(x, y, width, height))));
      raw[rowStart + 1 + x] = v;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function ensureSeedImages(uploadDir: string): Record<string, string> {
  fs.mkdirSync(uploadDir, { recursive: true });
  const files: Array<{
    name: string;
    w: number;
    h: number;
    fn: (x: number, y: number, w: number, h: number) => number;
  }> = [
    {
      name: 'seed-arch.png',
      w: 480,
      h: 480,
      // Minimalist brutalist architectural light & shadow study
      fn: (x, y, w, h) => {
        const nx = x / w;
        const ny = y / h;
        const diag = nx * 0.72 + ny * 0.28;
        if (Math.abs(nx - 0.5) < 0.008 || Math.abs(ny - 0.62) < 0.008) return 245;
        if (nx > 0.14 && nx < 0.86 && ny > 0.14 && ny < 0.86) {
          const steps = Math.floor(diag * 7) / 7;
          const stripe = (Math.floor(x / 24) % 2 === 0 ? 12 : -12);
          return 25 + steps * 195 + stripe;
        }
        return 14 + ny * 26;
      },
    },
    {
      name: 'seed-horizon.png',
      w: 480,
      h: 480,
      // Minimalist monochrome ocean horizon & moon
      fn: (x, y, w, h) => {
        const nx = x / w;
        const ny = y / h;
        const dx = nx - 0.68;
        const dy = ny - 0.28;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.095) return 248;
        if (ny < 0.58) {
          return 18 + (ny / 0.58) * 62;
        }
        const wave = Math.sin(ny * 140 + Math.sin(nx * 18) * 2) * 18;
        const reflection = Math.exp(-Math.pow((nx - 0.68) * 7, 2)) * 90 * (1 - (ny - 0.58));
        return 22 + (ny - 0.58) * 110 + wave + reflection;
      },
    },
    {
      name: 'seed-espresso.png',
      w: 480,
      h: 480,
      // Concentric minimalist studio circles (coffee cup overhead study)
      fn: (x, y, w, h) => {
        const nx = (x - w / 2) / (w / 2);
        const ny = (y - h / 2) / (h / 2);
        const r = Math.sqrt(nx * nx + ny * ny);
        if (r < 0.34) return 22 + r * 35;
        if (r < 0.42) return 242;
        if (r < 0.46) return 185;
        if (r < 0.68) return 235 - r * 30;
        if (r < 0.71) return 60;
        return 244 - (ny + 1) * 22;
      },
    },
    {
      name: 'seed-tokyo.png',
      w: 480,
      h: 480,
      // High-contrast vertical urban grid lines (Shibuya monochrome)
      fn: (x, y, w, h) => {
        const nx = x / w;
        const ny = y / h;
        const col = Math.floor(nx * 12);
        const row = Math.floor(ny * 16);
        const edge = Math.abs((nx * 12) % 1) < 0.07 || Math.abs((ny * 16) % 1) < 0.07;
        if (edge) return 12;
        const lit = (col * 7 + row * 13) % 5 === 0 ? 235 : 38 + ((col * 19 + row * 3) % 90);
        return lit * (1 - ny * 0.25);
      },
    },
  ];

  const urls: Record<string, string> = {};
  for (const f of files) {
    const outPath = path.join(uploadDir, f.name);
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, generateMonochromePng(f.w, f.h, f.fn));
    }
    urls[f.name] = `/uploads/${f.name}`;
  }
  return urls;
}

export function seedIfEmpty(db: DatabaseSync, config: AppConfig): void {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (row.cnt > 0) return;

  const imgs = ensureSeedImages(config.uploadDir);
  const now = Date.now();
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;

  const founderId = crypto.randomUUID();
  const mayaId = crypto.randomUUID();
  const liamId = crypto.randomUUID();
  const zaraId = crypto.randomUUID();

  const demoPasswordHash = hashPassword('MonoDemo!2026');

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, display_name, email, password_hash, bio, avatar_url, show_activity_status, last_active_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(
    founderId,
    config.founderUsername,
    'Abhishek',
    'founder@mono.app',
    demoPasswordHash,
    'Building MONO. Still frames, real friends, zero noise.',
    '',
    1,
    now - 15 * 1000, // Active now
    now - 45 * day
  );

  insertUser.run(
    mayaId,
    'maya',
    'Maya Lin',
    'maya@mono.app',
    demoPasswordHash,
    'Architecture & monochrome film.',
    '',
    1,
    now - 45 * 1000, // Active now
    now - 30 * day
  );

  insertUser.run(
    liamId,
    'liam',
    'Liam Chen',
    'liam@mono.app',
    demoPasswordHash,
    'Espresso, typography, slow travel.',
    '',
    1,
    now - 24 * min, // Last seen 24m ago
    now - 25 * day
  );

  insertUser.run(
    zaraId,
    'zara',
    'Zara Patel',
    'zara@mono.app',
    demoPasswordHash,
    'Design systems & Tokyo nights.',
    '',
    1,
    now - 3 * hour, // Last seen 3h ago
    now - 20 * day
  );

  // Mutual follows (strictly private — never shown as lists or counts!)
  const insertFollow = db.prepare(
    'INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)'
  );
  for (const a of [founderId, mayaId, liamId, zaraId]) {
    for (const b of [founderId, mayaId, liamId, zaraId]) {
      if (a !== b) insertFollow.run(a, b, now - 10 * day);
    }
  }

  // Posts (strictly photos, tags, locations — zero reels)
  const post1 = crypto.randomUUID();
  const post2 = crypto.randomUUID();
  const post3 = crypto.randomUUID();
  const post4 = crypto.randomUUID();

  const insertPost = db.prepare(`
    INSERT INTO posts (id, author_id, image_url, caption, location_name, location_city, filter_style, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPost.run(
    post1,
    founderId,
    imgs['seed-arch.png'],
    'Geometry in quiet morning light. No reels, no vanity metrics — just craft. #minimal #architecture #mono',
    'Apple Park Visitor Center',
    'Cupertino, CA',
    'noir',
    now - 42 * min
  );
  insertPost.run(
    post2,
    mayaId,
    imgs['seed-horizon.png'],
    'Low tide at dusk with @abhishek and @liam. #monochrome #coast #stillness',
    'Big Sur Coast',
    'California',
    'mono',
    now - 4 * hour
  );
  insertPost.run(
    post3,
    liamId,
    imgs['seed-espresso.png'],
    'Double cortado before studio hours. #coffee #minimalism #bw',
    'Blue Bottle Kiyosumi',
    'Tokyo',
    'silver',
    now - 11 * hour
  );
  insertPost.run(
    post4,
    zaraId,
    imgs['seed-tokyo.png'],
    'Midnight glass facades after dinner. #tokyo #urban #grid',
    'Shibuya Crossing',
    'Tokyo',
    'noir',
    now - 22 * hour
  );

  // Hashtags
  const insertTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)');
  for (const t of ['minimal', 'architecture', 'mono']) insertTag.run(post1, t);
  for (const t of ['monochrome', 'coast', 'stillness']) insertTag.run(post2, t);
  for (const t of ['coffee', 'minimalism', 'bw']) insertTag.run(post3, t);
  for (const t of ['tokyo', 'urban', 'grid']) insertTag.run(post4, t);

  // People tagged on photos
  const insertUserTag = db.prepare(
    'INSERT OR IGNORE INTO post_user_tags (post_id, tagged_user_id, pos_x, pos_y) VALUES (?, ?, ?, ?)'
  );
  insertUserTag.run(post2, founderId, 38, 56);
  insertUserTag.run(post2, liamId, 68, 62);
  insertUserTag.run(post4, mayaId, 52, 48);

  // Likes & Comments
  const insertLike = db.prepare(
    'INSERT OR IGNORE INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)'
  );
  insertLike.run(post1, mayaId, now - 35 * min);
  insertLike.run(post1, liamId, now - 20 * min);
  insertLike.run(post2, founderId, now - 3 * hour);

  const insertComment = db.prepare(
    'INSERT INTO post_comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  insertComment.run(crypto.randomUUID(), post1, mayaId, 'The contrast on this frame is unreal.', now - 30 * min);
  insertComment.run(crypto.randomUUID(), post2, founderId, 'Best evening light all week.', now - 2 * hour);

  // 24-hour Ephemeral Stories
  const insertStory = db.prepare(`
    INSERT INTO stories (id, author_id, media_url, text_content, bg_style, location_name, tagged_usernames, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertStory.run(
    crypto.randomUUID(),
    founderId,
    imgs['seed-arch.png'],
    'MONO v1.0 — pure B&W, zero reels, 30-day auto-erasing chats.',
    'noir',
    'Cupertino, CA',
    JSON.stringify(['maya']),
    now - 2 * hour,
    now - 2 * hour + config.storyTtlMs
  );
  insertStory.run(
    crypto.randomUUID(),
    mayaId,
    imgs['seed-horizon.png'],
    'Golden hour turned monochrome.',
    'paper',
    'Big Sur',
    JSON.stringify(['abhishek']),
    now - 5 * hour,
    now - 5 * hour + config.storyTtlMs
  );

  // 1:1 Direct Message conversation (30-day auto-erasing)
  const dmId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO conversations (id, type, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(dmId, 'dm', '', '', founderId, now - 3 * day);
  db.prepare(
    'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  ).run(dmId, founderId, 'member', now - 3 * day);
  db.prepare(
    'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  ).run(dmId, mayaId, 'member', now - 3 * day);

  const insertMsg = db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, body, message_type, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertMsg.run(
    crypto.randomUUID(),
    dmId,
    mayaId,
    'Love how calm this feels without reels or follower counts.',
    'text',
    now - 90 * min,
    now - 90 * min + config.messageTtlMs
  );
  insertMsg.run(
    crypto.randomUUID(),
    dmId,
    founderId,
    'And everything we send here auto-erases cleanly in 30 days.',
    'text',
    now - 82 * min,
    now - 82 * min + config.messageTtlMs
  );

  // Group Chat + Bill Splitting ("Tokyo Studio Trip")
  const groupId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO conversations (id, type, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(groupId, 'group', 'Tokyo Studio Trip', 'Photos, chat & shared expenses', founderId, now - 5 * day);

  const insertMember = db.prepare(
    'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  );
  insertMember.run(groupId, founderId, 'admin', now - 5 * day);
  insertMember.run(groupId, mayaId, 'member', now - 5 * day);
  insertMember.run(groupId, liamId, 'member', now - 5 * day);
  insertMember.run(groupId, zaraId, 'member', now - 5 * day);

  insertMsg.run(
    crypto.randomUUID(),
    groupId,
    founderId,
    'Added our Shibuya dinner & express train tickets to the Bills tab.',
    'text',
    now - 5 * hour,
    now - 5 * hour + config.messageTtlMs
  );

  // Seed 2 Group Bills
  const bill1Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO bills (id, conversation_id, title, total_cents, currency, paid_by_user_id, split_type, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bill1Id, groupId, 'Shibuya Omakase Dinner', 24000, 'USD', founderId, 'equal', 'Four-course tasting menu', now - 6 * hour);

  const splits1 = computeBillSplits({
    totalCents: 24000,
    splitType: 'equal',
    participantIds: [founderId, mayaId, liamId, zaraId],
  });
  const insertSplit = db.prepare(
    'INSERT INTO bill_splits (id, bill_id, user_id, owed_cents, settled, settled_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const s of splits1) {
    const isPayer = s.userId === founderId;
    insertSplit.run(crypto.randomUUID(), bill1Id, s.userId, s.owedCents, isPayer ? 1 : 0, isPayer ? now - 6 * hour : null);
  }

  const bill2Id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO bills (id, conversation_id, title, total_cents, currency, paid_by_user_id, split_type, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bill2Id, groupId, 'Narita Express Tickets', 9000, 'USD', mayaId, 'equal', 'Round-trip seats', now - 4 * hour);

  const splits2 = computeBillSplits({
    totalCents: 9000,
    splitType: 'equal',
    participantIds: [founderId, mayaId, liamId],
  });
  for (const s of splits2) {
    const isPayer = s.userId === mayaId;
    insertSplit.run(crypto.randomUUID(), bill2Id, s.userId, s.owedCents, isPayer ? 1 : 0, isPayer ? now - 4 * hour : null);
  }
}
