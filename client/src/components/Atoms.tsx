import React from 'react';
import { resolveMediaUrl } from '../api';
import { getInitials } from '../utils';
import type { UserSummary } from '../types';

/**
 * The ONLY non-monochrome element in MONO.
 * Rendered exclusively when the server verifies hasBlueTick === true (Founder account only).
 */
export const FounderBlueTick: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <span
    className="founder-tick"
    title="Verified Founder"
    aria-label="Verified Founder"
  >
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.25c1.38 0 2.58.74 3.24 1.85 1.24-.34 2.61.02 3.55.96.94.94 1.3 2.31.96 3.55 1.11.66 1.85 1.86 1.85 3.24s-.74 2.58-1.85 3.24c.34 1.24-.02 2.61-.96 3.55-.94.94-2.31 1.3-3.55.96-.66 1.11-1.86 1.85-3.24 1.85s-2.58-.74-3.24-1.85c-1.24.34-2.61-.02-3.55-.96-.94-.94-1.3-2.31-.96-3.55-1.11-.66-1.85-1.86-1.85-3.24s.74-2.58 1.85-3.24c-.34-1.24.02-2.61.96-3.55.94-.94 2.31-1.3 3.55-.96C9.42 2.99 10.62 2.25 12 2.25Zm4.28 7.53a.75.75 0 0 0-1.06-1.06l-4.47 4.47-1.97-1.97a.75.75 0 1 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l5-5Z" />
    </svg>
  </span>
);

export const Avatar: React.FC<{
  user: Pick<UserSummary, 'displayName' | 'username' | 'avatarUrl' | 'isActive'>;
  size?: number;
  showActiveDot?: boolean;
}> = ({ user, size = 38, showActiveDot = false }) => {
  return (
    <span className="avatar-wrap">
      <span
        className="avatar"
        style={{
          width: size,
          height: size,
          fontSize: Math.max(11, Math.round(size * 0.36)),
        }}
      >
        {user.avatarUrl ? (
          <img src={resolveMediaUrl(user.avatarUrl)} alt={user.displayName} />
        ) : (
          getInitials(user.displayName || user.username)
        )}
      </span>
      {showActiveDot && user.isActive && <span className="active-dot" title="Active now" />}
    </span>
  );
};

export const UsernameBadge: React.FC<{
  user: Pick<UserSummary, 'username' | 'hasBlueTick'>;
  prefix?: string;
  size?: number;
}> = ({ user, prefix = '', size = 15 }) => (
  <span className="username-row">
    <span>
      {prefix}
      {user.username}
    </span>
    {user.hasBlueTick && <FounderBlueTick size={size} />}
  </span>
);
