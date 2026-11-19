import type {
  CommentItem,
  ConversationSummary,
  GroupBillsResponse,
  MessageItem,
  PostItem,
  StoryGroup,
  UserSummary,
} from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'mono_auth_token_v1';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export function resolveMediaUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  return `${API_BASE}${url}`;
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    isFormData?: boolean;
  } = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!options.isFormData && options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.isFormData
      ? (options.body as FormData)
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  // Auth
  login: (identifier: string, password: string) =>
    request<{ token: string; user: UserSummary }>('/api/auth/login', {
      method: 'POST',
      body: { identifier, password },
    }),

  register: (payload: {
    username: string;
    displayName: string;
    email: string;
    password: string;
  }) =>
    request<{ token: string; user: UserSummary }>('/api/auth/register', {
      method: 'POST',
      body: payload,
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () =>
    request<{
      user: UserSummary;
      policy: {
        reelsEnabled: boolean;
        followerListsVisible: boolean;
        messageRetentionDays: number;
        storyRetentionHours: number;
      };
    }>('/api/auth/me'),

  pingPresence: () => request<{ ok: boolean }>('/api/presence/ping', { method: 'POST' }),

  // Users
  updateProfile: (payload: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    showActivityStatus?: boolean;
  }) =>
    request<{ user: UserSummary }>('/api/users/me', {
      method: 'PATCH',
      body: payload,
    }),

  deleteAccount: (password: string) =>
    request<{ deleted: boolean }>('/api/users/me', {
      method: 'DELETE',
      body: { password },
    }),

  searchUsers: (q: string) =>
    request<{ users: UserSummary[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),

  getUserProfile: (username: string) =>
    request<{ user: UserSummary; posts: PostItem[] }>(
      `/api/users/${encodeURIComponent(username)}`
    ),

  toggleFollow: (username: string) =>
    request<{ isFollowing: boolean }>(`/api/users/${encodeURIComponent(username)}/follow`, {
      method: 'POST',
    }),

  toggleBlock: (username: string) =>
    request<{ blocked: boolean }>(`/api/users/${encodeURIComponent(username)}/block`, {
      method: 'POST',
    }),

  reportContent: (payload: {
    targetType: 'post' | 'comment' | 'story' | 'user' | 'message';
    targetId: string;
    reason: string;
  }) => request<{ reported: boolean }>('/api/reports', { method: 'POST', body: payload }),

  // Uploads
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ url: string; mime: string; size: number }>('/api/uploads', {
      method: 'POST',
      body: fd,
      isFormData: true,
    });
  },

  // Posts (Zero Reels)
  getFeed: () => request<{ posts: PostItem[] }>('/api/posts/feed'),

  explorePosts: (params: { q?: string; tag?: string; location?: string }) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set('q', params.q);
    if (params.tag) sp.set('tag', params.tag);
    if (params.location) sp.set('location', params.location);
    const qs = sp.toString();
    return request<{ posts: PostItem[] }>(`/api/posts/explore${qs ? `?${qs}` : ''}`);
  },

  getSavedPosts: () => request<{ posts: PostItem[] }>('/api/posts/saved'),

  createPost: (payload: {
    imageUrl: string;
    caption: string;
    locationName: string;
    locationCity: string;
    filterStyle: 'mono' | 'noir' | 'silver' | 'raw';
    tags: string[];
    taggedUsers: Array<{ username: string; posX: number; posY: number }>;
  }) => request<{ post: PostItem }>('/api/posts', { method: 'POST', body: payload }),

  deletePost: (id: string) =>
    request<{ deleted: boolean }>(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  toggleLike: (id: string) =>
    request<{ isLiked: boolean; likeCount: number }>(`/api/posts/${encodeURIComponent(id)}/like`, {
      method: 'POST',
    }),

  toggleSave: (id: string) =>
    request<{ isSaved: boolean }>(`/api/posts/${encodeURIComponent(id)}/save`, {
      method: 'POST',
    }),

  addComment: (postId: string, body: string) =>
    request<{ comment: CommentItem }>(`/api/posts/${encodeURIComponent(postId)}/comments`, {
      method: 'POST',
      body: { body },
    }),

  // Stories (24h Ephemeral)
  getStories: () => request<{ storyGroups: StoryGroup[] }>('/api/stories'),

  createStory: (payload: {
    mediaUrl: string;
    textContent: string;
    bgStyle: 'noir' | 'paper' | 'slate';
    locationName: string;
    taggedUsernames: string[];
  }) => request<{ story: unknown }>('/api/stories', { method: 'POST', body: payload }),

  viewStory: (id: string) =>
    request<{ viewed: boolean }>(`/api/stories/${encodeURIComponent(id)}/view`, {
      method: 'POST',
    }),

  deleteStory: (id: string) =>
    request<{ deleted: boolean }>(`/api/stories/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Conversations & 30-Day Ephemeral Messages
  getConversations: () =>
    request<{ conversations: ConversationSummary[] }>('/api/conversations'),

  startDm: (username: string) =>
    request<{ conversationId: string }>('/api/conversations/dm', {
      method: 'POST',
      body: { username },
    }),

  createGroup: (payload: {
    name: string;
    description: string;
    memberUsernames: string[];
  }) =>
    request<{ conversationId: string }>('/api/conversations/group', {
      method: 'POST',
      body: payload,
    }),

  getMessages: (conversationId: string) =>
    request<{ messages: MessageItem[]; retentionPolicy: string }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`
    ),

  sendMessage: (conversationId: string, body: string) =>
    request<{ message: MessageItem }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', body: { body } }
    ),

  // Group Bill Splitting
  getGroupBills: (conversationId: string) =>
    request<GroupBillsResponse>(
      `/api/conversations/${encodeURIComponent(conversationId)}/bills`
    ),

  createBill: (
    conversationId: string,
    payload: {
      title: string;
      totalCents: number;
      currency: string;
      paidByUserId?: string;
      splitType: 'equal' | 'exact' | 'percentage';
      participantIds: string[];
      exactCents?: Record<string, number>;
      percentages?: Record<string, number>;
      notes?: string;
    }
  ) =>
    request<{ billId: string }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/bills`,
      { method: 'POST', body: payload }
    ),

  settleBillSplit: (billId: string, splitId: string) =>
    request<{ settled: boolean }>(
      `/api/bills/${encodeURIComponent(billId)}/splits/${encodeURIComponent(splitId)}/settle`,
      { method: 'POST' }
    ),

  deleteBill: (billId: string) =>
    request<{ deleted: boolean }>(`/api/bills/${encodeURIComponent(billId)}`, {
      method: 'DELETE',
    }),
};
