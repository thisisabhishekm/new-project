export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  hasBlueTick: boolean;
  isActive: boolean;
  lastSeenAt: number | null;
  createdAt: number;
  email?: string;
  showActivityStatus?: boolean;
  isFollowing?: boolean;
  postCount?: number;
}

export interface TaggedUserPin {
  id: string;
  username: string;
  displayName: string;
  hasBlueTick: boolean;
  posX: number;
  posY: number;
}

export interface CommentItem {
  id: string;
  body: string;
  createdAt: number;
  author: UserSummary;
}

export interface PostItem {
  id: string;
  imageUrl: string;
  caption: string;
  locationName: string;
  locationCity: string;
  filterStyle: 'mono' | 'noir' | 'silver' | 'raw' | string;
  createdAt: number;
  author: UserSummary;
  tags: string[];
  taggedUsers: TaggedUserPin[];
  likeCount: number;
  isLiked: boolean;
  isSaved: boolean;
  comments: CommentItem[];
}

export interface StoryItem {
  id: string;
  mediaUrl: string;
  textContent: string;
  bgStyle: 'noir' | 'paper' | 'slate' | string;
  locationName: string;
  taggedUsernames: string[];
  createdAt: number;
  expiresAt: number;
  isViewed: boolean;
  viewers?: UserSummary[];
}

export interface StoryGroup {
  author: UserSummary;
  hasUnseen: boolean;
  stories: StoryItem[];
}

export interface ConversationMember extends UserSummary {
  role: 'admin' | 'member';
}

export interface ConversationSummary {
  id: string;
  type: 'dm' | 'group';
  name: string;
  description: string;
  createdAt: number;
  members: ConversationMember[];
  openBillsCount: number;
  lastMessage: {
    id: string;
    body: string;
    messageType: 'text' | 'bill_event' | string;
    createdAt: number;
    expiresAt: number;
    senderUsername: string;
  } | null;
}

export interface MessageItem {
  id: string;
  body: string;
  messageType: 'text' | 'bill_event' | string;
  createdAt: number;
  expiresAt: number;
  daysRemaining: number;
  sender: UserSummary;
}

export interface BillSplitItem {
  id: string;
  userId: string;
  user: UserSummary | null;
  owedCents: number;
  settled: boolean;
  settledAt: number | null;
}

export interface BillItem {
  id: string;
  title: string;
  totalCents: number;
  currency: string;
  paidByUserId: string;
  paidBy: UserSummary | null;
  splitType: 'equal' | 'exact' | 'percentage';
  notes: string;
  createdAt: number;
  splits: BillSplitItem[];
}

export interface SimplifiedTransfer {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  fromUser: UserSummary | null;
  toUser: UserSummary | null;
}

export interface GroupBillsResponse {
  bills: BillItem[];
  summary: {
    netBalances: Record<string, number>;
    transfers: SimplifiedTransfer[];
  };
}
