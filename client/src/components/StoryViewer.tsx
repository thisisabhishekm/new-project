import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, MapPin, Trash2, X } from 'lucide-react';
import { api, resolveMediaUrl } from '../api';
import type { StoryGroup, UserSummary } from '../types';
import { formatRelativeTime } from '../utils';
import { Avatar, UsernameBadge } from './Atoms';

interface StoryViewerProps {
  group: StoryGroup;
  currentUser: UserSummary;
  onClose: () => void;
  onStoryDeleted: () => void;
  onOpenUser: (username: string) => void;
}

export const StoryViewer: React.FC<StoryViewerProps> = ({
  group,
  currentUser,
  onClose,
  onStoryDeleted,
  onOpenUser,
}) => {
  const [index, setIndex] = useState(0);
  const [showViewers, setShowViewers] = useState(false);

  const story = group.stories[index];
  const isOwner = group.author.id === currentUser.id;

  useEffect(() => {
    if (!story) return;
    api.viewStory(story.id).catch(() => {});
  }, [story]);

  if (!story) return null;

  function goNext() {
    if (index < group.stories.length - 1) setIndex(index + 1);
    else onClose();
  }

  function goPrev() {
    if (index > 0) setIndex(index - 1);
  }

  async function handleDelete() {
    await api.deleteStory(story.id);
    onStoryDeleted();
    onClose();
  }

  const bgColor =
    story.bgStyle === 'paper' ? '#f5f5f7' : story.bgStyle === 'slate' ? '#1c1c1e' : '#000000';
  const textColor = story.bgStyle === 'paper' ? '#000000' : '#ffffff';

  return (
    <div className="story-viewer" style={{ background: bgColor, color: textColor }}>
      {/* Progress bars */}
      <div className="story-progress-row">
        {group.stories.map((s, i) => (
          <div
            key={s.id}
            className="story-progress-bar"
            style={{
              background:
                story.bgStyle === 'paper' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.28)',
            }}
          >
            <div
              className="story-progress-fill"
              style={{
                width: i <= index ? '100%' : '0%',
                background: textColor,
              }}
            />
          </div>
        ))}
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px 10px',
        }}
      >
        <button
          type="button"
          style={{ display: 'flex', alignItems: 'center', gap: 10, color: textColor }}
          onClick={() => {
            onClose();
            onOpenUser(group.author.username);
          }}
        >
          <Avatar user={group.author} size={34} />
          <div style={{ textAlign: 'left' }}>
            <UsernameBadge user={group.author} />
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              {formatRelativeTime(story.createdAt)} · 24h story
            </div>
          </div>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isOwner && (
            <button
              type="button"
              className="icon-btn"
              style={{ color: textColor }}
              aria-label="Delete story"
              onClick={handleDelete}
            >
              <Trash2 size={18} strokeWidth={1.6} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            style={{ color: textColor }}
            aria-label="Close story"
            onClick={onClose}
          >
            <X size={22} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Main Story Canvas */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          overflow: 'hidden',
        }}
      >
        {story.mediaUrl && (
          <img
            src={resolveMediaUrl(story.mediaUrl)}
            alt={story.textContent || 'Story'}
            style={{
              maxWidth: '100%',
              maxHeight: '68dvh',
              borderRadius: 16,
              objectFit: 'contain',
              filter: 'grayscale(100%) contrast(1.1)',
            }}
          />
        )}

        {story.textContent && (
          <p
            style={{
              marginTop: story.mediaUrl ? 18 : 0,
              fontSize: story.mediaUrl ? 16 : 24,
              fontWeight: story.mediaUrl ? 500 : 600,
              letterSpacing: '-0.02em',
              textAlign: 'center',
              maxWidth: 340,
              lineHeight: 1.4,
            }}
          >
            {story.textContent}
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, justifyContent: 'center' }}>
          {story.locationName && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 999,
                border: `0.5px solid ${story.bgStyle === 'paper' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)'}`,
              }}
            >
              <MapPin size={12} />
              {story.locationName}
            </span>
          )}
          {story.taggedUsernames.map((u) => (
            <span
              key={u}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 999,
                border: `0.5px solid ${story.bgStyle === 'paper' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)'}`,
              }}
            >
              @{u}
            </span>
          ))}
        </div>

        {/* Tap Nav Controls */}
        {index > 0 && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous story"
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 36,
              height: 36,
              borderRadius: 999,
              background: 'rgba(128,128,128,0.25)',
              color: textColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <button
          type="button"
          onClick={goNext}
          aria-label="Next story"
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 36,
            height: 36,
            borderRadius: 999,
            background: 'rgba(128,128,128,0.25)',
            color: textColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Author-only viewer list */}
      {isOwner && (
        <div
          style={{
            padding: '12px 18px calc(18px + env(safe-area-inset-bottom, 0px))',
            borderTop: '0.5px solid rgba(255,255,255,0.14)',
          }}
        >
          <button
            type="button"
            onClick={() => setShowViewers((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: textColor,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Eye size={16} strokeWidth={1.6} />
            <span>
              Seen by {story.viewers?.length ?? 0} {(story.viewers?.length ?? 0) === 1 ? 'person' : 'people'}
            </span>
          </button>

          {showViewers && story.viewers && story.viewers.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {story.viewers.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <Avatar user={v} size={26} />
                  <UsernameBadge user={v} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
