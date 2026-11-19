import React, { useCallback, useEffect, useState } from 'react';
import {
  Home,
  MessageCircle,
  Moon,
  Plus,
  PlusSquare,
  Search,
  Sun,
  User,
} from 'lucide-react';
import { api, getStoredToken, setStoredToken } from './api';
import type { PostItem, StoryGroup, UserSummary } from './types';
import { AuthScreen } from './components/AuthScreen';
import { Avatar } from './components/Atoms';
import { PostCard } from './components/PostCard';
import { StoryViewer } from './components/StoryViewer';
import { CreateView } from './components/CreateView';
import { ExploreView } from './components/ExploreView';
import { MessagesView } from './components/MessagesView';
import { ProfileView } from './components/ProfileView';

type Tab = 'feed' | 'explore' | 'create' | 'messages' | 'profile';

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('mono_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [currentUser, setCurrentUser] = useState<UserSummary | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>('feed');

  // Feed & Stories state
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [activeStoryGroup, setActiveStoryGroup] = useState<StoryGroup | null>(null);

  // Navigation overlays
  const [viewingUsername, setViewingUsername] = useState<string | null>(null);
  const [exploreTag, setExploreTag] = useState('');
  const [exploreLocation, setExploreLocation] = useState('');
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mono_theme', theme);
  }, [theme]);

  // Restore session on mount
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setBooting(false);
      return;
    }
    api
      .me()
      .then((res) => setCurrentUser(res.user))
      .catch(() => setStoredToken(null))
      .finally(() => setBooting(false));
  }, []);

  // Presence heartbeat every 60s
  useEffect(() => {
    if (!currentUser) return;
    const id = setInterval(() => {
      api.pingPresence().catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [currentUser]);

  const loadFeedAndStories = useCallback(async () => {
    if (!currentUser) return;
    try {
      const [feedRes, storyRes] = await Promise.all([api.getFeed(), api.getStories()]);
      setPosts(feedRes.posts);
      setStoryGroups(storyRes.storyGroups);
    } catch {
      notify('Could not refresh feed.');
    }
  }, [currentUser, notify]);

  useEffect(() => {
    if (currentUser) {
      loadFeedAndStories();
    }
  }, [currentUser, loadFeedAndStories]);

  function handleOpenUser(username: string) {
    if (currentUser && username.toLowerCase() === currentUser.username.toLowerCase()) {
      setViewingUsername(null);
      setTab('profile');
    } else {
      setViewingUsername(username);
    }
  }

  function handleSelectTag(tag: string) {
    setViewingUsername(null);
    setExploreLocation('');
    setExploreTag(tag);
    setTab('explore');
  }

  function handleSelectLocation(loc: string) {
    setViewingUsername(null);
    setExploreTag('');
    setExploreLocation(loc);
    setTab('explore');
  }

  function handleOpenDm(conversationId: string) {
    setViewingUsername(null);
    setPendingConversationId(conversationId);
    setTab('messages');
  }

  function handleLogout() {
    setStoredToken(null);
    setCurrentUser(null);
    setViewingUsername(null);
    setTab('feed');
  }

  if (booting) {
    return (
      <div className="auth-screen" style={{ alignItems: 'center' }}>
        <div className="wordmark" style={{ fontSize: 28, letterSpacing: '0.24em' }}>
          MONO
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={setCurrentUser} />;
  }

  const headerTitle = viewingUsername
    ? `@${viewingUsername}`
    : tab === 'feed'
      ? null
      : tab === 'explore'
        ? 'Explore'
        : tab === 'create'
          ? 'Create'
          : tab === 'messages'
            ? 'Messages & Bills'
            : 'Profile';

  return (
    <div className="app-shell">
      {toast && <div className="toast">{toast}</div>}

      {/* Top Apple HIG Frosted Header */}
      <header className="hig-header">
        {headerTitle ? (
          <div className="header-title">{headerTitle}</div>
        ) : (
          <div className="wordmark">MONO</div>
        )}

        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Toggle black and white theme"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun size={19} strokeWidth={1.6} /> : <Moon size={19} strokeWidth={1.6} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Create post or story"
            onClick={() => {
              setViewingUsername(null);
              setTab('create');
            }}
          >
            <Plus size={21} strokeWidth={1.7} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {viewingUsername ? (
          <ProfileView
            username={viewingUsername}
            currentUser={currentUser}
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            onBack={() => setViewingUsername(null)}
            onOpenDm={handleOpenDm}
            onCurrentUserUpdated={setCurrentUser}
            onLoggedOut={handleLogout}
            onNotify={notify}
          />
        ) : tab === 'feed' ? (
          <div>
            {/* 24-Hour Stories Strip */}
            <div className="stories-strip">
              <button
                type="button"
                className="story-bubble"
                onClick={() => setTab('create')}
              >
                <span className="story-ring add">
                  <Plus size={22} strokeWidth={1.6} />
                </span>
                <span className="story-username">Add story</span>
              </button>

              {storyGroups.map((group) => (
                <button
                  key={group.author.id}
                  type="button"
                  className="story-bubble"
                  onClick={() => setActiveStoryGroup(group)}
                >
                  <span className={`story-ring ${group.hasUnseen ? '' : 'seen'}`}>
                    <Avatar user={group.author} size={54} />
                  </span>
                  <span className="story-username">
                    {group.author.id === currentUser.id ? 'Your story' : group.author.username}
                  </span>
                </button>
              ))}
            </div>

            {/* Chronological Still Photo Feed (Zero Reels) */}
            {posts.length === 0 ? (
              <div className="empty-state">
                <div style={{ fontWeight: 600 }}>Your feed is quiet.</div>
                <div style={{ fontSize: 13 }}>
                  Share a monochrome photo or explore people to follow.
                </div>
                <button type="button" className="btn-primary" onClick={() => setTab('explore')}>
                  Explore People
                </button>
              </div>
            ) : (
              posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={currentUser}
                  onOpenUser={handleOpenUser}
                  onSelectTag={handleSelectTag}
                  onSelectLocation={handleSelectLocation}
                  onUpdated={(updated) =>
                    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                  }
                  onDeleted={(postId) =>
                    setPosts((prev) => prev.filter((p) => p.id !== postId))
                  }
                  onNotify={notify}
                />
              ))
            )}
          </div>
        ) : tab === 'explore' ? (
          <ExploreView
            initialTag={exploreTag}
            initialLocation={exploreLocation}
            onClearInitialFilters={() => {
              setExploreTag('');
              setExploreLocation('');
            }}
            onOpenUser={handleOpenUser}
            onNotify={notify}
          />
        ) : tab === 'create' ? (
          <CreateView
            onCreatedPost={() => {
              loadFeedAndStories();
              setTab('feed');
            }}
            onCreatedStory={() => {
              loadFeedAndStories();
              setTab('feed');
            }}
            onNotify={notify}
          />
        ) : tab === 'messages' ? (
          <MessagesView
            currentUser={currentUser}
            initialConversationId={pendingConversationId}
            onClearInitialConversation={() => setPendingConversationId(null)}
            onNotify={notify}
          />
        ) : (
          <ProfileView
            username={currentUser.username}
            currentUser={currentUser}
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            onOpenDm={handleOpenDm}
            onCurrentUserUpdated={setCurrentUser}
            onLoggedOut={handleLogout}
            onNotify={notify}
          />
        )}
      </main>

      {/* Fullscreen 24h Story Viewer */}
      {activeStoryGroup && (
        <StoryViewer
          group={activeStoryGroup}
          currentUser={currentUser}
          onClose={() => {
            setActiveStoryGroup(null);
            loadFeedAndStories();
          }}
          onStoryDeleted={loadFeedAndStories}
          onOpenUser={handleOpenUser}
        />
      )}

      {/* Apple HIG 5-Tab Bottom Bar (Explicitly NO Reels Tab) */}
      <nav className="hig-tabbar" aria-label="Primary navigation">
        {(
          [
            { id: 'feed', label: 'Feed', Icon: Home },
            { id: 'explore', label: 'Explore', Icon: Search },
            { id: 'create', label: 'Create', Icon: PlusSquare },
            { id: 'messages', label: 'Chats', Icon: MessageCircle },
            { id: 'profile', label: 'Profile', Icon: User },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = !viewingUsername && tab === id;
          return (
            <button
              key={id}
              type="button"
              className={`tab-btn ${active ? 'active' : ''}`}
              onClick={() => {
                setViewingUsername(null);
                setTab(id);
              }}
            >
              <Icon size={22} strokeWidth={active ? 2.1 : 1.5} />
              <span className="tab-label">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
