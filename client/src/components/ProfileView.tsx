import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Grid,
  Lock,
  LogOut,
  MessageCircle,
  Moon,
  Settings,
  Shield,
  Sun,
  Trash2,
  UserX,
  X,
} from 'lucide-react';
import { api, resolveMediaUrl } from '../api';
import type { PostItem, UserSummary } from '../types';
import { filterStyleToCss, formatPresence } from '../utils';
import { Avatar, UsernameBadge } from './Atoms';

interface ProfileViewProps {
  username: string;
  currentUser: UserSummary;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onBack?: () => void;
  onOpenDm: (conversationId: string) => void;
  onCurrentUserUpdated: (user: UserSummary) => void;
  onLoggedOut: () => void;
  onNotify: (msg: string) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  username,
  currentUser,
  theme,
  onToggleTheme,
  onBack,
  onOpenDm,
  onCurrentUserUpdated,
  onLoggedOut,
  onNotify,
}) => {
  const isSelf = username.toLowerCase() === currentUser.username.toLowerCase();
  const [profile, setProfile] = useState<UserSummary | null>(isSelf ? currentUser : null);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [savedPosts, setSavedPosts] = useState<PostItem[]>([]);
  const [gridTab, setGridTab] = useState<'posts' | 'saved'>('posts');
  const [selectedPost, setSelectedPost] = useState<PostItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Settings / Edit sheets
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState(currentUser.displayName);
  const [editBio, setEditBio] = useState(currentUser.bio);
  const [showActivity, setShowActivity] = useState(currentUser.showActivityStatus !== false);
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getUserProfile(username),
      isSelf ? api.getSavedPosts() : Promise.resolve({ posts: [] }),
    ])
      .then(([res, savedRes]) => {
        if (cancelled) return;
        setProfile(res.user);
        setPosts(res.posts);
        setSavedPosts(savedRes.posts);
        if (isSelf) {
          setEditName(res.user.displayName);
          setEditBio(res.user.bio);
          setShowActivity(res.user.showActivityStatus !== false);
        }
      })
      .catch(() => {
        if (!cancelled) onNotify('Could not load profile.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username, isSelf, onNotify]);

  async function handleFollowToggle() {
    if (!profile) return;
    try {
      const res = await api.toggleFollow(profile.username);
      setProfile({ ...profile, isFollowing: res.isFollowing });
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  async function handleMessage() {
    if (!profile) return;
    try {
      const res = await api.startDm(profile.username);
      onOpenDm(res.conversationId);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not open chat.');
    }
  }

  async function handleBlock() {
    if (!profile) return;
    try {
      await api.toggleBlock(profile.username);
      onNotify(`Blocked @${profile.username}.`);
      onBack?.();
    } catch {
      onNotify('Could not block user.');
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await api.updateProfile({
        displayName: editName,
        bio: editBio,
        showActivityStatus: showActivity,
      });
      setProfile(res.user);
      onCurrentUserUpdated(res.user);
      setShowSettings(false);
      onNotify('Profile & privacy settings saved.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save settings.');
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const up = await api.uploadImage(file);
      const res = await api.updateProfile({ avatarUrl: up.url });
      setProfile(res.user);
      onCurrentUserUpdated(res.user);
      onNotify('Profile photo updated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Avatar upload failed.');
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // Clear local session regardless
    }
    onLoggedOut();
  }

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.deleteAccount(deletePassword);
      onNotify('Account permanently deleted.');
      onLoggedOut();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not delete account.');
    }
  }

  if (loading && !profile) {
    return <div className="empty-state">Loading profile…</div>;
  }

  if (!profile) {
    return <div className="empty-state">Profile unavailable.</div>;
  }

  const displayedPosts = gridTab === 'saved' && isSelf ? savedPosts : posts;

  return (
    <div>
      {onBack && (
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '0.5px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Go back">
            <ArrowLeft size={20} strokeWidth={1.7} />
          </button>
          <UsernameBadge user={profile} />
        </div>
      )}

      {/* Profile Header */}
      <div style={{ padding: '20px 18px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar user={profile} size={74} showActiveDot />
            <div>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {profile.displayName}
              </div>
              <div style={{ marginTop: 2 }}>
                <UsernameBadge user={profile} prefix="@" size={16} />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {formatPresence(profile.isActive, profile.lastSeenAt)} · {posts.length}{' '}
                {posts.length === 1 ? 'post' : 'posts'}
              </div>
            </div>
          </div>

          {isSelf && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Settings"
              onClick={() => setShowSettings(true)}
            >
              <Settings size={21} strokeWidth={1.6} />
            </button>
          )}
        </div>

        {profile.bio && (
          <p style={{ margin: '14px 0 0', fontSize: 14, lineHeight: 1.45 }}>{profile.bio}</p>
        )}

        {/* Strict Privacy Guarantee — Zero Follower/Following Counts or Lists */}
        <div
          style={{
            marginTop: 14,
            padding: '8px 12px',
            borderRadius: 10,
            background: 'var(--bg-subtle)',
            fontSize: 12,
            color: 'var(--fg-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Lock size={13} strokeWidth={1.7} />
          <span>Follower & following lists are private on MONO.</span>
        </div>

        {/* Action Row */}
        {!isSelf ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className={profile.isFollowing ? 'btn-secondary' : 'btn-primary'}
              style={{ flex: 1, minHeight: 40 }}
              onClick={handleFollowToggle}
            >
              {profile.isFollowing ? 'Following' : 'Follow'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ flex: 1, minHeight: 40 }}
              onClick={handleMessage}
            >
              <MessageCircle size={15} strokeWidth={1.6} />
              Message
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ minHeight: 40, padding: '0 12px' }}
              aria-label="Block user"
              onClick={handleBlock}
            >
              <UserX size={15} strokeWidth={1.6} />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ flex: 1, minHeight: 38 }}
              onClick={() => setShowSettings(true)}
            >
              Edit Profile & Privacy
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ minHeight: 38, padding: '0 12px' }}
              onClick={onToggleTheme}
              aria-label="Toggle monochrome theme"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        )}
      </div>

      {/* Posts / Saved Switcher */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isSelf ? '1fr 1fr' : '1fr',
          borderTop: '0.5px solid var(--border)',
          borderBottom: '0.5px solid var(--border)',
        }}
      >
        <button
          type="button"
          onClick={() => setGridTab('posts')}
          style={{
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            borderBottom: gridTab === 'posts' ? '2px solid var(--fg)' : '2px solid transparent',
            color: gridTab === 'posts' ? 'var(--fg)' : 'var(--fg-secondary)',
          }}
        >
          <Grid size={16} strokeWidth={1.6} />
          <span>Posts</span>
        </button>
        {isSelf && (
          <button
            type="button"
            onClick={() => setGridTab('saved')}
            style={{
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              borderBottom: gridTab === 'saved' ? '2px solid var(--fg)' : '2px solid transparent',
              color: gridTab === 'saved' ? 'var(--fg)' : 'var(--fg-secondary)',
            }}
          >
            <Bookmark size={16} strokeWidth={1.6} />
            <span>Saved</span>
          </button>
        )}
      </div>

      {/* Photo Grid */}
      {displayedPosts.length === 0 ? (
        <div className="empty-state">
          <span>{gridTab === 'saved' ? 'No saved photos yet.' : 'No photos shared yet.'}</span>
        </div>
      ) : (
        <div className="photo-grid">
          {displayedPosts.map((p) => (
            <button
              key={p.id}
              type="button"
              className="photo-grid-tile"
              onClick={() => setSelectedPost(p)}
            >
              <img
                src={resolveMediaUrl(p.imageUrl)}
                alt={p.caption || 'Post'}
                style={{ filter: filterStyleToCss(p.filterStyle) }}
              />
            </button>
          ))}
        </div>
      )}

      {/* Selected Photo Preview Sheet */}
      {selectedPost && (
        <div className="sheet-backdrop" onClick={() => setSelectedPost(null)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <img
              src={resolveMediaUrl(selectedPost.imageUrl)}
              alt={selectedPost.caption}
              style={{
                width: '100%',
                borderRadius: 14,
                filter: filterStyleToCss(selectedPost.filterStyle),
              }}
            />
            {selectedPost.locationName && (
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                {selectedPost.locationName}
                {selectedPost.locationCity ? `, ${selectedPost.locationCity}` : ''}
              </div>
            )}
            {selectedPost.caption && (
              <p style={{ fontSize: 14, marginTop: 6 }}>{selectedPost.caption}</p>
            )}
          </div>
        </div>
      )}

      {/* SETTINGS & PLAY STORE PRIVACY / ACCOUNT DELETION SHEET */}
      {showSettings && isSelf && (
        <div className="sheet-backdrop" onClick={() => setShowSettings(false)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <div className="header-title">Profile & Privacy</div>
              <button type="button" className="icon-btn" onClick={() => setShowSettings(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label
                className="btn-secondary"
                style={{ cursor: 'pointer', justifyContent: 'center' }}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarUpload}
                  style={{ display: 'none' }}
                />
                Change Profile Photo
              </label>

              <div>
                <label className="field-label">Display Name</label>
                <input
                  className="hig-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={50}
                  required
                />
              </div>

              <div>
                <label className="field-label">Bio</label>
                <textarea
                  className="hig-textarea"
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  maxLength={180}
                />
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--bg-subtle)',
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Show Activity & Last Seen</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Reciprocal: hiding yours also hides others&apos; status.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={showActivity}
                  onChange={(e) => setShowActivity(e.target.checked)}
                />
              </label>

              <button type="submit" className="btn-primary">
                Save Changes
              </button>
            </form>

            {/* Security & Data Retention Summary */}
            <div
              style={{
                marginTop: 18,
                padding: '12px 14px',
                borderRadius: 12,
                border: '0.5px solid var(--border-strong)',
                fontSize: 12,
                color: 'var(--fg-secondary)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg)', fontWeight: 600 }}>
                <Shield size={14} />
                <span>MONO Privacy & Safety Policy</span>
              </div>
              <div>• Messages automatically and permanently erase after 30 days.</div>
              <div>• Stories permanently expire after 24 hours.</div>
              <div>• Follower & following lists are hidden server-side from everyone.</div>
              <div>• Zero Reels, zero ad trackers, zero third-party data resale.</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn-secondary" onClick={handleLogout}>
                <LogOut size={15} />
                Sign Out
              </button>

              {!confirmDelete ? (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ opacity: 0.75 }}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={15} />
                  Delete Account Permanently
                </button>
              ) : (
                <form
                  onSubmit={handleDeleteAccount}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid var(--border-strong)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12 }}>
                    Enter your password to permanently erase your account, posts, and messages:
                  </div>
                  <input
                    type="password"
                    className="hig-input"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Confirm password"
                    required
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary" style={{ flex: 1 }}>
                      Confirm Delete
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
