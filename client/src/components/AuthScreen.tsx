import React, { useState } from 'react';
import { Lock, Receipt, ShieldCheck, Timer } from 'lucide-react';
import { api, setStoredToken } from '../api';
import type { UserSummary } from '../types';
import { FounderBlueTick } from './Atoms';

interface AuthScreenProps {
  onAuthenticated: (user: UserSummary) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await api.login(identifier, password);
        setStoredToken(res.token);
        onAuthenticated(res.user);
      } else {
        const res = await api.register({ username, displayName, email, password });
        setStoredToken(res.token);
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  async function quickDemoLogin(demoUser: 'abhishek' | 'maya') {
    setError('');
    setLoading(true);
    try {
      const res = await api.login(demoUser, 'MonoDemo!2026');
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div style={{ textAlign: 'center' }}>
        <div className="wordmark" style={{ fontSize: 32, letterSpacing: '0.24em' }}>
          MONO
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
          Still frames. Real friends. Zero noise.
        </p>
      </div>

      <div className="segmented">
        <button
          type="button"
          className={`segmented-btn ${mode === 'login' ? 'active' : ''}`}
          onClick={() => {
            setMode('login');
            setError('');
          }}
        >
          Sign In
        </button>
        <button
          type="button"
          className={`segmented-btn ${mode === 'register' ? 'active' : ''}`}
          onClick={() => {
            setMode('register');
            setError('');
          }}
        >
          Create Account
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mode === 'login' ? (
          <div>
            <label className="field-label">Username or Email</label>
            <input
              className="hig-input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="abhishek or email"
              autoComplete="username"
              required
            />
          </div>
        ) : (
          <>
            <div>
              <label className="field-label">Username</label>
              <input
                className="hig-input"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="yourhandle"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="field-label">Display Name</label>
              <input
                className="hig-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your Name"
                required
              />
            </div>
            <div>
              <label className="field-label">Email</label>
              <input
                type="email"
                className="hig-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
          </>
        )}

        <div>
          <label className="field-label">Password</label>
          <input
            type="password"
            className="hig-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'Min 8 chars, letters & numbers' : '••••••••'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
        </div>

        {error && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-subtle)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: 4 }}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Continue' : 'Join MONO'}
        </button>
      </form>

      {/* Quick Demo Preview */}
      <div
        style={{
          borderTop: '0.5px solid var(--border)',
          paddingTop: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div className="field-label" style={{ textAlign: 'center', marginBottom: 0 }}>
          Instant Preview Accounts
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => quickDemoLogin('abhishek')}
          >
            <span>@abhishek</span>
            <FounderBlueTick size={14} />
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => quickDemoLogin('maya')}
          >
            <span>@maya</span>
          </button>
        </div>
      </div>

      {/* Minimal Principles Footer */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          paddingTop: 6,
          fontSize: 12,
          color: 'var(--fg-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <ShieldCheck size={14} strokeWidth={1.6} />
          <span>No Reels, ever</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Lock size={14} strokeWidth={1.6} />
          <span>Private follower lists</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Timer size={14} strokeWidth={1.6} />
          <span>30-day auto-erase chat</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Receipt size={14} strokeWidth={1.6} />
          <span>Group bill splitting</span>
        </div>
      </div>
    </div>
  );
};
