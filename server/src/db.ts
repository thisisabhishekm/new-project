import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function initDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      show_activity_status INTEGER NOT NULL DEFAULT 1,
      last_active_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    -- Follows are strictly internal for feed composition & toggle state.
    -- NEVER exposed as a list or count in any public or private API.
    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      location_name TEXT NOT NULL DEFAULT '',
      location_city TEXT NOT NULL DEFAULT '',
      filter_style TEXT NOT NULL DEFAULT 'mono',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);

    CREATE TABLE IF NOT EXISTS post_tags (
      post_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (post_id, tag),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);

    CREATE TABLE IF NOT EXISTS post_user_tags (
      post_id TEXT NOT NULL,
      tagged_user_id TEXT NOT NULL,
      pos_x REAL NOT NULL DEFAULT 50,
      pos_y REAL NOT NULL DEFAULT 50,
      PRIMARY KEY (post_id, tagged_user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (tagged_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_saves (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments(post_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      media_url TEXT NOT NULL DEFAULT '',
      text_content TEXT NOT NULL DEFAULT '',
      bg_style TEXT NOT NULL DEFAULT 'noir',
      location_name TEXT NOT NULL DEFAULT '',
      tagged_usernames TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);

    CREATE TABLE IF NOT EXISTS story_views (
      story_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      viewed_at INTEGER NOT NULL,
      PRIMARY KEY (story_id, viewer_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'bill_event')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);

    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      title TEXT NOT NULL,
      total_cents INTEGER NOT NULL CHECK (total_cents > 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      paid_by_user_id TEXT NOT NULL,
      split_type TEXT NOT NULL CHECK (split_type IN ('equal', 'exact', 'percentage')),
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bills_conv ON bills(conversation_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS bill_splits (
      id TEXT PRIMARY KEY,
      bill_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      owed_cents INTEGER NOT NULL CHECK (owed_cents >= 0),
      settled INTEGER NOT NULL DEFAULT 0,
      settled_at INTEGER,
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bill_splits_bill ON bill_splits(bill_id);

    -- Play Store UGC safety compliance: user blocking & content reporting
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id),
      FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'story', 'user', 'message')),
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  return db;
}

export interface PurgeStats {
  deletedMessages: number;
  deletedStories: number;
  deletedRevokedTokens: number;
}

/**
 * Permanently erases expired messages (past 30-day TTL), expired stories (past 24h TTL),
 * and expired JWT revocation entries.
 */
export function purgeExpiredData(db: DatabaseSync, nowMs = Date.now()): PurgeStats {
  const msgResult = db.prepare('DELETE FROM messages WHERE expires_at <= ?').run(nowMs);
  const storyResult = db.prepare('DELETE FROM stories WHERE expires_at <= ?').run(nowMs);
  const tokenResult = db.prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(nowMs);

  return {
    deletedMessages: Number(msgResult.changes),
    deletedStories: Number(storyResult.changes),
    deletedRevokedTokens: Number(tokenResult.changes),
  };
}
