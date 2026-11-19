import React, { useEffect, useState } from 'react';
import { MapPin, Search, Tag, X } from 'lucide-react';
import { api, resolveMediaUrl } from '../api';
import type { PostItem, UserSummary } from '../types';
import { filterStyleToCss, formatPresence } from '../utils';
import { Avatar, UsernameBadge } from './Atoms';

interface ExploreViewProps {
  initialTag?: string;
  initialLocation?: string;
  onClearInitialFilters?: () => void;
  onOpenUser: (username: string) => void;
  onNotify: (msg: string) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  initialTag = '',
  initialLocation = '',
  onClearInitialFilters,
  onOpenUser,
  onNotify,
}) => {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState(initialTag);
  const [activeLocation, setActiveLocation] = useState(initialLocation);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [selectedPost, setSelectedPost] = useState<PostItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setActiveTag(initialTag);
    setActiveLocation(initialLocation);
  }, [initialTag, initialLocation]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.searchUsers(query),
      api.explorePosts({
        q: !activeTag && !activeLocation ? query : undefined,
        tag: activeTag || undefined,
        location: activeLocation || undefined,
      }),
    ])
      .then(([uRes, pRes]) => {
        if (cancelled) return;
        setUsers(uRes.users);
        setPosts(pRes.posts);
      })
      .catch(() => {
        if (!cancelled) onNotify('Failed to load explore results.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, activeTag, activeLocation, onNotify]);

  async function handleFollowToggle(target: UserSummary) {
    try {
      const res = await api.toggleFollow(target.username);
      setUsers((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, isFollowing: res.isFollowing } : u))
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  return (
    <div>
      {/* Search Bar */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={16}
            strokeWidth={1.7}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--fg-secondary)',
            }}
          />
          <input
            className="hig-input"
            style={{ paddingLeft: 38, paddingRight: 34 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people, #tags, or locations…"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--fg-secondary)',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {(activeTag || activeLocation) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {activeTag && (
              <button
                type="button"
                className="btn-pill solid"
                onClick={() => {
                  setActiveTag('');
                  onClearInitialFilters?.();
                }}
              >
                <Tag size={12} />#{activeTag}
                <X size={12} />
              </button>
            )}
            {activeLocation && (
              <button
                type="button"
                className="btn-pill solid"
                onClick={() => {
                  setActiveLocation('');
                  onClearInitialFilters?.();
                }}
              >
                <MapPin size={12} />
                {activeLocation}
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* People Results (Zero follower counts or lists) */}
      {users.length > 0 && (
        <div style={{ borderTop: '0.5px solid var(--border)' }}>
          <div className="field-label" style={{ padding: '12px 16px 4px', marginBottom: 0 }}>
            People
          </div>
          {users.slice(0, query ? 8 : 4).map((u) => (
            <div key={u.id} className="list-row" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                onClick={() => onOpenUser(u.username)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', flex: 1 }}
              >
                <Avatar user={u} size={42} showActiveDot />
                <div>
                  <UsernameBadge user={u} />
                  <div className="muted" style={{ fontSize: 12 }}>
                    {u.displayName} · {formatPresence(u.isActive, u.lastSeenAt)}
                  </div>
                </div>
              </button>
              <button
                type="button"
                className={`btn-pill ${u.isFollowing ? '' : 'solid'}`}
                onClick={() => handleFollowToggle(u)}
              >
                {u.isFollowing ? 'Following' : 'Follow'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Photo Grid */}
      <div style={{ padding: '12px 16px 8px' }}>
        <div className="field-label" style={{ marginBottom: 0 }}>
          Still Frames
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">No photos match this filter yet.</div>
      ) : (
        <div className="photo-grid">
          {posts.map((p) => (
            <button
              key={p.id}
              type="button"
              className="photo-grid-tile"
              onClick={() => setSelectedPost(p)}
            >
              <img
                src={resolveMediaUrl(p.imageUrl)}
                alt={p.caption || p.locationName || 'Photo'}
                style={{ filter: filterStyleToCss(p.filterStyle) }}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox Sheet */}
      {selectedPost && (
        <div className="sheet-backdrop" onClick={() => setSelectedPost(null)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedPost(null);
                  onOpenUser(selectedPost.author.username);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <Avatar user={selectedPost.author} size={34} showActiveDot />
                <div style={{ textAlign: 'left' }}>
                  <UsernameBadge user={selectedPost.author} />
                  {selectedPost.locationName && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {selectedPost.locationName}
                    </div>
                  )}
                </div>
              </button>
              <button type="button" className="icon-btn" onClick={() => setSelectedPost(null)}>
                <X size={18} />
              </button>
            </div>
            <img
              src={resolveMediaUrl(selectedPost.imageUrl)}
              alt={selectedPost.caption}
              style={{
                width: '100%',
                borderRadius: 14,
                filter: filterStyleToCss(selectedPost.filterStyle),
              }}
            />
            {selectedPost.caption && (
              <p style={{ fontSize: 14, marginTop: 12, marginBottom: 6 }}>{selectedPost.caption}</p>
            )}
            {selectedPost.tags.length > 0 && (
              <div className="tag-chip-row">
                {selectedPost.tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="tag-chip"
                    onClick={() => {
                      setSelectedPost(null);
                      setActiveTag(t);
                    }}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
