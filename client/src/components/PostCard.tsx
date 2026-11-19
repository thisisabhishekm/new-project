import React, { useState } from 'react';
import {
  Bookmark,
  Flag,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Tag,
  Trash2,
} from 'lucide-react';
import { api, resolveMediaUrl } from '../api';
import type { PostItem, UserSummary } from '../types';
import { filterStyleToCss, formatPresence, formatRelativeTime } from '../utils';
import { Avatar, FounderBlueTick, UsernameBadge } from './Atoms';

interface PostCardProps {
  post: PostItem;
  currentUser: UserSummary;
  onOpenUser: (username: string) => void;
  onSelectTag?: (tag: string) => void;
  onSelectLocation?: (location: string) => void;
  onUpdated: (post: PostItem) => void;
  onDeleted: (postId: string) => void;
  onNotify: (msg: string) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  currentUser,
  onOpenUser,
  onSelectTag,
  onSelectLocation,
  onUpdated,
  onDeleted,
  onNotify,
}) => {
  const [showTags, setShowTags] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleLike() {
    try {
      const res = await api.toggleLike(post.id);
      onUpdated({ ...post, isLiked: res.isLiked, likeCount: res.likeCount });
    } catch {
      onNotify('Could not update like.');
    }
  }

  async function handleSave() {
    try {
      const res = await api.toggleSave(post.id);
      onUpdated({ ...post, isSaved: res.isSaved });
      onNotify(res.isSaved ? 'Saved to bookmarks.' : 'Removed from saved.');
    } catch {
      onNotify('Could not update bookmark.');
    }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.addComment(post.id, commentText.trim());
      onUpdated({ ...post, comments: [...post.comments, res.comment] });
      setCommentText('');
      setShowAllComments(true);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Comment failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    try {
      await api.deletePost(post.id);
      setShowMenu(false);
      onDeleted(post.id);
      onNotify('Post deleted.');
    } catch {
      onNotify('Could not delete post.');
    }
  }

  async function handleReport() {
    try {
      await api.reportContent({
        targetType: 'post',
        targetId: post.id,
        reason: 'Reported by user from feed',
      });
      setShowMenu(false);
      onNotify('Thank you. Post reported for review.');
    } catch {
      onNotify('Could not submit report.');
    }
  }

  const visibleComments = showAllComments ? post.comments : post.comments.slice(-2);

  return (
    <article className="post-card">
      <div className="post-header">
        <button
          type="button"
          className="post-author-btn"
          onClick={() => onOpenUser(post.author.username)}
        >
          <Avatar user={post.author} size={36} showActiveDot />
          <div className="post-author-meta">
            <UsernameBadge user={post.author} />
            <div className="post-submeta">
              {post.locationName ? (
                <span
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  onClick={(e) => {
                    if (onSelectLocation) {
                      e.stopPropagation();
                      onSelectLocation(post.locationName);
                    }
                  }}
                >
                  <MapPin size={11} strokeWidth={1.7} />
                  {post.locationName}
                  {post.locationCity ? `, ${post.locationCity}` : ''}
                </span>
              ) : (
                <span>{formatPresence(post.author.isActive, post.author.lastSeenAt)}</span>
              )}
              <span>·</span>
              <span>{formatRelativeTime(post.createdAt)}</span>
            </div>
          </div>
        </button>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Post options"
            onClick={() => setShowMenu((v) => !v)}
          >
            <MoreHorizontal size={18} strokeWidth={1.6} />
          </button>
          {showMenu && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 42,
                zIndex: 20,
                minWidth: 160,
                background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border-strong)',
                borderRadius: 12,
                boxShadow: 'var(--shadow-sheet)',
                overflow: 'hidden',
              }}
            >
              {post.author.id === currentUser.id ? (
                <button
                  type="button"
                  className="list-row"
                  style={{ padding: '10px 14px', fontSize: 13 }}
                  onClick={handleDelete}
                >
                  <Trash2 size={14} strokeWidth={1.6} />
                  <span>Delete post</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="list-row"
                  style={{ padding: '10px 14px', fontSize: 13 }}
                  onClick={handleReport}
                >
                  <Flag size={14} strokeWidth={1.6} />
                  <span>Report post</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Monochrome Photo Surface */}
      <div
        className="post-image-frame"
        onDoubleClick={handleLike}
        onClick={() => {
          if (post.taggedUsers.length > 0) setShowTags((v) => !v);
        }}
      >
        <img
          src={resolveMediaUrl(post.imageUrl)}
          alt={post.caption || `Photo by ${post.author.username}`}
          style={{ filter: filterStyleToCss(post.filterStyle) }}
          loading="lazy"
        />

        {post.taggedUsers.length > 0 && (
          <button
            type="button"
            className="tag-toggle-badge"
            aria-label="Toggle tagged people"
            onClick={(e) => {
              e.stopPropagation();
              setShowTags((v) => !v);
            }}
          >
            <Tag size={14} strokeWidth={1.8} />
          </button>
        )}

        {showTags &&
          post.taggedUsers.map((tu) => (
            <button
              key={tu.id}
              type="button"
              className="photo-tag-pin"
              style={{ left: `${tu.posX}%`, top: `${tu.posY}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenUser(tu.username);
              }}
            >
              <span>@{tu.username}</span>
              {tu.hasBlueTick && <FounderBlueTick size={12} />}
            </button>
          ))}
      </div>

      {/* Action Bar */}
      <div className="post-actions">
        <div className="post-actions-left">
          <button type="button" className="icon-btn" aria-label="Like" onClick={handleLike}>
            <Heart
              size={22}
              strokeWidth={1.6}
              fill={post.isLiked ? 'currentColor' : 'none'}
            />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Comments"
            onClick={() => setShowAllComments((v) => !v)}
          >
            <MessageCircle size={22} strokeWidth={1.6} />
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label="Save" onClick={handleSave}>
          <Bookmark
            size={21}
            strokeWidth={1.6}
            fill={post.isSaved ? 'currentColor' : 'none'}
          />
        </button>
      </div>

      {/* Caption, Tags & Comments */}
      <div className="post-body">
        {post.likeCount > 0 && (
          <div className="post-likes">
            {post.likeCount} {post.likeCount === 1 ? 'like' : 'likes'}
          </div>
        )}

        {post.caption && (
          <div className="post-caption">
            <button
              type="button"
              style={{ fontWeight: 600, marginRight: 6 }}
              onClick={() => onOpenUser(post.author.username)}
            >
              <UsernameBadge user={post.author} size={13} />
            </button>
            <span>{post.caption}</span>
          </div>
        )}

        {post.tags.length > 0 && (
          <div className="tag-chip-row">
            {post.tags.map((t) => (
              <button
                key={t}
                type="button"
                className="tag-chip"
                onClick={() => onSelectTag?.(t)}
              >
                #{t}
              </button>
            ))}
          </div>
        )}

        {post.comments.length > 2 && !showAllComments && (
          <button
            type="button"
            className="muted"
            style={{ fontSize: 12, marginTop: 8 }}
            onClick={() => setShowAllComments(true)}
          >
            View all {post.comments.length} comments
          </button>
        )}

        {visibleComments.length > 0 && (
          <div className="post-comments-preview">
            {visibleComments.map((c) => (
              <div key={c.id} className="comment-line">
                <button
                  type="button"
                  style={{ fontWeight: 600, marginRight: 6 }}
                  onClick={() => onOpenUser(c.author.username)}
                >
                  <UsernameBadge user={c.author} size={12} />
                </button>
                <span>{c.body}</span>
              </div>
            ))}
          </div>
        )}

        <form className="comment-form" onSubmit={handleComment}>
          <input
            className="comment-input"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
            maxLength={400}
          />
          {commentText.trim() && (
            <button
              type="submit"
              disabled={submitting}
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              Post
            </button>
          )}
        </form>
      </div>
    </article>
  );
};
