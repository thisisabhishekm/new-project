import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, type MonoAppInstance } from '../src/app.js';
import { purgeExpiredData } from '../src/db.js';
import { computeBillSplits, simplifyGroupDebts } from '../src/bills.js';

function makeValidPng(): Buffer {
  // Minimal valid 1x1 PNG binary
  return Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fea7d646420000000049454e44ae426082',
    'hex'
  );
}

describe('MONO Security Audit, Breach Tests & Quality Control', () => {
  let instance: MonoAppInstance;
  let tmpUploadDir: string;

  beforeEach(() => {
    tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-test-uploads-'));
    instance = createApp(
      {
        dbPath: ':memory:',
        uploadDir: tmpUploadDir,
        founderUsername: 'abhishek',
        jwtSecret: 'test-super-secret-key-at-least-32-bytes-long-123456',
        disableRateLimit: true,
      },
      { seed: true, startPurgeTimer: false }
    );
  });

  afterEach(() => {
    instance.close();
    fs.rmSync(tmpUploadDir, { recursive: true, force: true });
  });

  async function loginAs(identifier: string, password = 'MonoDemo!2026') {
    const res = await request(instance.app)
      .post('/api/auth/login')
      .send({ identifier, password })
      .expect(200);
    return { token: res.body.token as string, user: res.body.user };
  }

  it('1. Enforces security headers and hides server fingerprint', async () => {
    const res = await request(instance.app).get('/api/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.body.policy.reelsEnabled).toBe(false);
    expect(res.body.policy.followerListsVisible).toBe(false);
    expect(res.body.policy.messageRetentionDays).toBe(30);
  });

  it('2. Permanently blocks Reels endpoints (No Reels by design)', async () => {
    await request(instance.app).get('/api/reels').expect(404);
    await request(instance.app).post('/api/reels').expect(404);
    await request(instance.app).get('/api/reels/trending').expect(404);
  });

  it('3. Grants exclusive Blue Tick ONLY to founder & blocks privilege escalation', async () => {
    const founder = await loginAs('abhishek');
    expect(founder.user.hasBlueTick).toBe(true);

    const maya = await loginAs('maya');
    expect(maya.user.hasBlueTick).toBe(false);

    // Attempt mass-assignment during registration
    const reg = await request(instance.app)
      .post('/api/auth/register')
      .send({
        username: 'attacker_user',
        displayName: 'Attacker',
        email: 'attacker@example.com',
        password: 'Password123',
        hasBlueTick: true,
        isFounder: true,
      })
      .expect(201);
    expect(reg.body.user.hasBlueTick).toBe(false);

    // Attempt mass-assignment during profile patch
    const patch = await request(instance.app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        displayName: 'Still Regular',
        hasBlueTick: true,
        isFounder: true,
        username: 'abhishek',
      })
      .expect(200);
    expect(patch.body.user.hasBlueTick).toBe(false);
    expect(patch.body.user.username).toBe('attacker_user');
  });

  it('4. Keeps follower & following lists and counts completely hidden from everyone', async () => {
    const founder = await loginAs('abhishek');
    const maya = await loginAs('maya');

    // Direct list probes must return 403 even for founder or self
    await request(instance.app)
      .get('/api/users/abhishek/followers')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(403);
    await request(instance.app)
      .get('/api/users/abhishek/following')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(403);
    await request(instance.app)
      .get('/api/users/maya/followers')
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(403);

    // Profile payload must NEVER expose follower/following counts or lists
    const profile = await request(instance.app)
      .get('/api/users/abhishek')
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(200);
    const keys = Object.keys(profile.body.user);
    expect(keys).not.toContain('followers');
    expect(keys).not.toContain('following');
    expect(keys).not.toContain('followerCount');
    expect(keys).not.toContain('followingCount');
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('password_hash');
    expect(profile.body.user.hasBlueTick).toBe(true);
  });

  it('5. Rejects forged alg:none JWTs, tampered tokens, and revoked tokens', async () => {
    const founder = await loginAs('abhishek');

    // Forge alg:none token
    const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const fakePayload = Buffer.from(
      JSON.stringify({
        sub: founder.user.id,
        username: 'abhishek',
        jti: 'forged',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');
    await request(instance.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${fakeHeader}.${fakePayload}.`)
      .expect(401);

    // Tamper signature
    const parts = founder.token.split('.');
    await request(instance.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${parts[0]}.${parts[1]}.invalid_signature`)
      .expect(401);

    // Logout must immediately revoke token
    await request(instance.app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(200);
    await request(instance.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(401);
  });

  it('6. Enforces reciprocal privacy for Last Seen & Active Status', async () => {
    const founder = await loginAs('abhishek');
    const maya = await loginAs('maya');

    // Both have activity status enabled -> visible
    const before = await request(instance.app)
      .get('/api/users/abhishek')
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(200);
    expect(before.body.user.lastSeenAt).toBeTypeOf('number');

    // Maya hides her activity status -> Maya can no longer see Abhishek's, and Abhishek can't see Maya's
    await request(instance.app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${maya.token}`)
      .send({ showActivityStatus: false })
      .expect(200);

    const mayaSeesFounder = await request(instance.app)
      .get('/api/users/abhishek')
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(200);
    expect(mayaSeesFounder.body.user.lastSeenAt).toBeNull();
    expect(mayaSeesFounder.body.user.isActive).toBe(false);

    const founderSeesMaya = await request(instance.app)
      .get('/api/users/maya')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(200);
    expect(founderSeesMaya.body.user.lastSeenAt).toBeNull();
    expect(founderSeesMaya.body.user.isActive).toBe(false);
  });

  it('7. Automatically erases messages after 30 days (hard delete + read filter)', async () => {
    const founder = await loginAs('abhishek');
    const convs = await request(instance.app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(200);
    const dm = convs.body.conversations.find((c: { type: string }) => c.type === 'dm');
    expect(dm).toBeTruthy();

    const sent = await request(instance.app)
      .post(`/api/conversations/${dm.id}/messages`)
      .set('Authorization', `Bearer ${founder.token}`)
      .send({ body: 'Ephemeral 30-day secret message' })
      .expect(201);

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(sent.body.message.expiresAt - sent.body.message.createdAt).toBe(thirtyDaysMs);

    // Simulate 31 days passing by setting expires_at in the past for that message
    const past = Date.now() - 1000;
    instance.db
      .prepare('UPDATE messages SET expires_at = ? WHERE id = ?')
      .run(past, sent.body.message.id);

    // Fetching messages immediately excludes and purges it
    const fetched = await request(instance.app)
      .get(`/api/conversations/${dm.id}/messages`)
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(200);
    const found = fetched.body.messages.find(
      (m: { id: string }) => m.id === sent.body.message.id
    );
    expect(found).toBeUndefined();

    // Verify it is hard-deleted from SQLite (not soft-deleted!)
    const rowInDb = instance.db
      .prepare('SELECT id FROM messages WHERE id = ?')
      .get(sent.body.message.id);
    expect(rowInDb).toBeUndefined();
  });

  it('8. Expires stories after 24 hours & restricts viewer list to story author only', async () => {
    const founder = await loginAs('abhishek');
    const maya = await loginAs('maya');

    const created = await request(instance.app)
      .post('/api/stories')
      .set('Authorization', `Bearer ${founder.token}`)
      .send({ textContent: '24h monochrome note', bgStyle: 'noir', locationName: 'Tokyo' })
      .expect(201);

    const storyId = created.body.story.id as string;

    // Maya views the story
    await request(instance.app)
      .post(`/api/stories/${storyId}/view`)
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(200);

    // Maya should NOT receive the viewers array for Abhishek's story
    const mayaStories = await request(instance.app)
      .get('/api/stories')
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(200);
    const founderGroupForMaya = mayaStories.body.storyGroups.find(
      (g: { author: { username: string } }) => g.author.username === 'abhishek'
    );
    const targetForMaya = founderGroupForMaya.stories.find((s: { id: string }) => s.id === storyId);
    expect(targetForMaya.viewers).toBeUndefined();

    // Abhishek SHOULD see Maya in viewers
    const founderStories = await request(instance.app)
      .get('/api/stories')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(200);
    const founderGroupSelf = founderStories.body.storyGroups.find(
      (g: { author: { username: string } }) => g.author.username === 'abhishek'
    );
    const targetForSelf = founderGroupSelf.stories.find((s: { id: string }) => s.id === storyId);
    expect(targetForSelf.viewers.some((v: { username: string }) => v.username === 'maya')).toBe(true);

    // Expire story past 24h -> purged permanently
    instance.db.prepare('UPDATE stories SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, storyId);
    const stats = purgeExpiredData(instance.db);
    expect(stats.deletedStories).toBeGreaterThanOrEqual(1);
    expect(instance.db.prepare('SELECT id FROM stories WHERE id = ?').get(storyId)).toBeUndefined();
  });

  it('9. Prevents IDOR breaches across groups, DMs, posts, and bills', async () => {
    const founder = await loginAs('abhishek');
    const regOutsider = await request(instance.app)
      .post('/api/auth/register')
      .send({
        username: 'outsider',
        displayName: 'Outsider',
        email: 'outsider@example.com',
        password: 'Password123',
      })
      .expect(201);
    const outsiderToken = regOutsider.body.token as string;

    const convs = await request(instance.app)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(200);
    const group = convs.body.conversations.find((c: { type: string }) => c.type === 'group');

    // Outsider cannot read group messages, post messages, view bills, or add bills
    await request(instance.app)
      .get(`/api/conversations/${group.id}/messages`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
    await request(instance.app)
      .post(`/api/conversations/${group.id}/messages`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ body: 'intrusion' })
      .expect(403);
    await request(instance.app)
      .get(`/api/conversations/${group.id}/bills`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
    await request(instance.app)
      .post(`/api/conversations/${group.id}/bills`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        title: 'Fake bill',
        totalCents: 5000,
        splitType: 'equal',
        participantIds: [founder.user.id],
      })
      .expect(403);

    // Outsider cannot delete founder's post
    const feed = await request(instance.app)
      .get('/api/posts/feed')
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(200);
    const founderPost = feed.body.posts.find(
      (p: { author: { username: string } }) => p.author.username === 'abhishek'
    );
    await request(instance.app)
      .delete(`/api/posts/${founderPost.id}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('10. Validates cent-accurate Bill Splitting, Debt Simplification & Settlement', async () => {
    // Unit-level precision checks
    const eq = computeBillSplits({
      totalCents: 1000,
      splitType: 'equal',
      participantIds: ['u1', 'u2', 'u3'],
    });
    expect(eq.map((s) => s.owedCents)).toEqual([334, 333, 333]);
    expect(eq.reduce((a, b) => a + b.owedCents, 0)).toBe(1000);

    const pct = computeBillSplits({
      totalCents: 1000,
      splitType: 'percentage',
      participantIds: ['u1', 'u2', 'u3'],
      percentages: { u1: 33.33, u2: 33.33, u3: 33.34 },
    });
    expect(pct.reduce((a, b) => a + b.owedCents, 0)).toBe(1000);

    expect(() =>
      computeBillSplits({
        totalCents: 1000,
        splitType: 'exact',
        participantIds: ['u1', 'u2'],
        exactCents: { u1: 600, u2: 300 },
      })
    ).toThrow();

    const simplified = simplifyGroupDebts(
      ['a', 'b', 'c'],
      [
        { paidByUserId: 'a', debtorUserId: 'b', owedCents: 5000 },
        { paidByUserId: 'b', debtorUserId: 'c', owedCents: 5000 },
      ]
    );
    expect(simplified.transfers).toEqual([{ fromUserId: 'c', toUserId: 'a', amountCents: 5000 }]);

    // End-to-end group bill creation & settlement via API
    const founder = await loginAs('abhishek');
    const maya = await loginAs('maya');
    const groupRes = await request(instance.app)
      .post('/api/conversations/group')
      .set('Authorization', `Bearer ${founder.token}`)
      .send({ name: 'Coffee Club', memberUsernames: ['maya'] })
      .expect(201);
    const groupId = groupRes.body.conversationId as string;

    await request(instance.app)
      .post(`/api/conversations/${groupId}/bills`)
      .set('Authorization', `Bearer ${founder.token}`)
      .send({
        title: 'Matcha & Pastries',
        totalCents: 2500,
        currency: 'USD',
        splitType: 'equal',
        participantIds: [founder.user.id, maya.user.id],
      })
      .expect(201);

    const billsBefore = await request(instance.app)
      .get(`/api/conversations/${groupId}/bills`)
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(200);
    expect(billsBefore.body.summary.transfers).toHaveLength(1);
    expect(billsBefore.body.summary.transfers[0].amountCents).toBe(1250);

    const bill = billsBefore.body.bills[0];
    const mayaSplit = bill.splits.find((s: { userId: string }) => s.userId === maya.user.id);
    await request(instance.app)
      .post(`/api/bills/${bill.id}/splits/${mayaSplit.id}/settle`)
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(200);

    const billsAfter = await request(instance.app)
      .get(`/api/conversations/${groupId}/bills`)
      .set('Authorization', `Bearer ${maya.token}`)
      .expect(200);
    expect(billsAfter.body.summary.transfers).toHaveLength(0);
  });

  it('11. Blocks malicious uploads (XSS SVG / spoofed JPG) and allows real PNGs', async () => {
    const founder = await loginAs('abhishek');

    // Attempt SVG upload with XSS payload
    await request(instance.app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${founder.token}`)
      .attach('file', Buffer.from('<svg onload="alert(1)"></svg>'), {
        filename: 'evil.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400);

    // Attempt spoofed .jpg containing script text
    await request(instance.app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${founder.token}`)
      .attach('file', Buffer.from('<script>alert("xss")</script>'), {
        filename: 'spoof.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    // Valid PNG succeeds and is served with nosniff
    const ok = await request(instance.app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${founder.token}`)
      .attach('file', makeValidPng(), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(ok.body.url).toMatch(/^\/uploads\/.+\.png$/);

    const served = await request(instance.app).get(ok.body.url).expect(200);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  it('12. Resists SQL injection & enforces Play Store UGC safety (Block, Report, Account Deletion)', async () => {
    const founder = await loginAs('abhishek');

    // SQLi attempt on login & search
    await request(instance.app)
      .post('/api/auth/login')
      .send({ identifier: "' OR 1=1 --", password: 'wrong' })
      .expect(401);

    const searchRes = await request(instance.app)
      .get("/api/users/search?q=' OR 1=1 --")
      .set('Authorization', `Bearer ${founder.token}`)
      .expect(200);
    expect(searchRes.body.users).toEqual([]);

    // Report endpoint
    await request(instance.app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${founder.token}`)
      .send({ targetType: 'post', targetId: 'some-post', reason: 'Spam content' })
      .expect(201);

    // Account creation + Play Store compliant self-deletion
    const temp = await request(instance.app)
      .post('/api/auth/register')
      .send({
        username: 'delete_me',
        displayName: 'Temp User',
        email: 'temp@example.com',
        password: 'DeleteMe123',
      })
      .expect(201);

    // Wrong password rejected
    await request(instance.app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${temp.body.token}`)
      .send({ password: 'WrongPassword1' })
      .expect(401);

    // Correct password deletes account & revokes session
    await request(instance.app)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${temp.body.token}`)
      .send({ password: 'DeleteMe123' })
      .expect(200);

    await request(instance.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${temp.body.token}`)
      .expect(401);
  });
});
