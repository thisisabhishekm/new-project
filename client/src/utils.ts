export function formatRelativeTime(timestampMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return 'now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(timestampMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatPresence(isActive: boolean, lastSeenAt: number | null): string {
  if (isActive) return 'Active now';
  if (!lastSeenAt) return 'Status private';
  const diffMin = Math.max(1, Math.floor((Date.now() - lastSeenAt) / 60000));
  if (diffMin < 60) return `Last seen ${diffMin}m ago`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last seen ${days}d ago`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  INR: '₹',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CAD: 'CA$',
  AUD: 'A$',
};

export function formatMoney(cents: number, currency = 'USD'): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const abs = Math.abs(cents) / 100;
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `-${sym}${formatted}` : `${sym}${formatted}`;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'M';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function filterStyleToCss(filterStyle: string): string {
  switch (filterStyle) {
    case 'noir':
      return 'grayscale(100%) contrast(1.25) brightness(0.96)';
    case 'silver':
      return 'grayscale(100%) contrast(0.95) brightness(1.08)';
    case 'raw':
      return 'grayscale(100%) contrast(1.05)';
    case 'mono':
    default:
      return 'grayscale(100%) contrast(1.12)';
  }
}
