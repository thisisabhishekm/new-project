import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MessageSquarePlus,
  Plus,
  Receipt,
  Send,
  Timer,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import type {
  ConversationSummary,
  GroupBillsResponse,
  MessageItem,
  UserSummary,
} from '../types';
import { formatMoney, formatPresence, formatRelativeTime } from '../utils';
import { Avatar, UsernameBadge } from './Atoms';

interface MessagesViewProps {
  currentUser: UserSummary;
  initialConversationId?: string | null;
  onClearInitialConversation?: () => void;
  onNotify: (msg: string) => void;
}

export const MessagesView: React.FC<MessagesViewProps> = ({
  currentUser,
  initialConversationId = null,
  onClearInitialConversation,
  onNotify,
}) => {
  const [listFilter, setListFilter] = useState<'all' | 'dm' | 'group'>('all');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId);
  const [groupSubTab, setGroupSubTab] = useState<'chat' | 'bills'>('chat');

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [billsData, setBillsData] = useState<GroupBillsResponse | null>(null);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);

  // Modals
  const [showNewModal, setShowNewModal] = useState<'dm' | 'group' | null>(null);
  const [allUsers, setAllUsers] = useState<UserSummary[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  // New Bill modal state
  const [showBillModal, setShowBillModal] = useState(false);
  const [billTitle, setBillTitle] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billCurrency, setBillCurrency] = useState('USD');
  const [billSplitType, setBillSplitType] = useState<'equal' | 'exact' | 'percentage'>('equal');
  const [billPaidBy, setBillPaidBy] = useState(currentUser.id);
  const [billParticipants, setBillParticipants] = useState<string[]>([]);
  const [billCustomValues, setBillCustomValues] = useState<Record<string, string>>({});
  const [billNotes, setBillNotes] = useState('');

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.getConversations();
      setConversations(res.conversations);
    } catch {
      onNotify('Failed to load conversations.');
    }
  }, [onNotify]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (initialConversationId) {
      setActiveConvId(initialConversationId);
      onClearInitialConversation?.();
    }
  }, [initialConversationId, onClearInitialConversation]);

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  const loadThreadData = useCallback(
    async (conv: ConversationSummary) => {
      try {
        const mRes = await api.getMessages(conv.id);
        setMessages(mRes.messages);
        if (conv.type === 'group') {
          const bRes = await api.getGroupBills(conv.id);
          setBillsData(bRes);
        } else {
          setBillsData(null);
        }
      } catch {
        onNotify('Could not load conversation.');
      }
    },
    [onNotify]
  );

  useEffect(() => {
    if (activeConv) {
      loadThreadData(activeConv);
    }
  }, [activeConv, loadThreadData]);

  async function openNewModal(kind: 'dm' | 'group') {
    setShowNewModal(kind);
    setGroupName('');
    setGroupDesc('');
    setSelectedMembers([]);
    try {
      const res = await api.searchUsers('');
      setAllUsers(res.users.filter((u) => u.id !== currentUser.id));
    } catch {
      onNotify('Could not load people.');
    }
  }

  async function handleStartDm(username: string) {
    try {
      const res = await api.startDm(username);
      setShowNewModal(null);
      await loadConversations();
      setActiveConvId(res.conversationId);
      setGroupSubTab('chat');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not start chat.');
    }
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    try {
      const res = await api.createGroup({
        name: groupName.trim(),
        description: groupDesc.trim(),
        memberUsernames: selectedMembers,
      });
      setShowNewModal(null);
      await loadConversations();
      setActiveConvId(res.conversationId);
      setGroupSubTab('chat');
      onNotify('Group created.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not create group.');
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConv || !msgText.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.sendMessage(activeConv.id, msgText.trim());
      setMessages((prev) => [...prev, res.message]);
      setMsgText('');
      loadConversations();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setSending(false);
    }
  }

  function openNewBillModal() {
    if (!activeConv) return;
    const ids = activeConv.members.map((m) => m.id);
    setBillTitle('');
    setBillAmount('');
    setBillCurrency('USD');
    setBillSplitType('equal');
    setBillPaidBy(currentUser.id);
    setBillParticipants(ids);
    setBillCustomValues({});
    setBillNotes('');
    setShowBillModal(true);
  }

  async function handleCreateBill(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConv) return;
    const totalNum = Number.parseFloat(billAmount);
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      onNotify('Enter a valid amount greater than zero.');
      return;
    }
    const totalCents = Math.round(totalNum * 100);
    if (billParticipants.length === 0) {
      onNotify('Select at least one person to split with.');
      return;
    }

    const payload: Parameters<typeof api.createBill>[1] = {
      title: billTitle.trim(),
      totalCents,
      currency: billCurrency,
      paidByUserId: billPaidBy,
      splitType: billSplitType,
      participantIds: billParticipants,
      notes: billNotes.trim(),
    };

    if (billSplitType === 'exact') {
      const exactCents: Record<string, number> = {};
      for (const uid of billParticipants) {
        exactCents[uid] = Math.round((Number.parseFloat(billCustomValues[uid] || '0') || 0) * 100);
      }
      payload.exactCents = exactCents;
    } else if (billSplitType === 'percentage') {
      const percentages: Record<string, number> = {};
      for (const uid of billParticipants) {
        percentages[uid] = Number.parseFloat(billCustomValues[uid] || '0') || 0;
      }
      payload.percentages = percentages;
    }

    try {
      await api.createBill(activeConv.id, payload);
      setShowBillModal(false);
      await loadThreadData(activeConv);
      await loadConversations();
      onNotify('Bill split added to group.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not split bill.');
    }
  }

  async function handleSettleSplit(billId: string, splitId: string) {
    if (!activeConv) return;
    try {
      await api.settleBillSplit(billId, splitId);
      await loadThreadData(activeConv);
      await loadConversations();
      onNotify('Split marked as settled.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not settle split.');
    }
  }

  // ==================== THREAD VIEW (DM or GROUP + BILLS) ====================
  if (activeConv) {
    const otherDmUser =
      activeConv.type === 'dm'
        ? activeConv.members.find((m) => m.id !== currentUser.id) ?? activeConv.members[0]
        : null;

    return (
      <div>
        {/* Thread Top Bar */}
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '0.5px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            background: 'var(--bg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Back to messages"
              onClick={() => setActiveConvId(null)}
            >
              <ArrowLeft size={20} strokeWidth={1.7} />
            </button>

            {activeConv.type === 'dm' && otherDmUser ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <Avatar user={otherDmUser} size={34} showActiveDot />
                <div>
                  <UsernameBadge user={otherDmUser} />
                  <div className="muted" style={{ fontSize: 11 }}>
                    {formatPresence(otherDmUser.isActive, otherDmUser.lastSeenAt)}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{activeConv.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {activeConv.members.length} members · Chat & Bill Split
                </div>
              </div>
            )}
          </div>

          {activeConv.type === 'group' && (
            <button type="button" className="btn-pill solid" onClick={openNewBillModal}>
              <Plus size={13} />
              Split Bill
            </button>
          )}
        </div>

        {/* Group Chat / Bills Segmented Switcher */}
        {activeConv.type === 'group' && (
          <div style={{ padding: '10px 16px 6px' }}>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-btn ${groupSubTab === 'chat' ? 'active' : ''}`}
                onClick={() => setGroupSubTab('chat')}
              >
                Chat (30d)
              </button>
              <button
                type="button"
                className={`segmented-btn ${groupSubTab === 'bills' ? 'active' : ''}`}
                onClick={() => setGroupSubTab('bills')}
              >
                Bills ({billsData?.bills.length ?? 0})
              </button>
            </div>
          </div>
        )}

        {/* CHAT TAB */}
        {(activeConv.type === 'dm' || groupSubTab === 'chat') && (
          <div className="chat-container" style={{ height: activeConv.type === 'group' ? 'calc(100dvh - 220px)' : 'calc(100dvh - 175px)' }}>
            <div className="info-banner" style={{ margin: '10px 16px 4px' }}>
              <Timer size={14} strokeWidth={1.6} />
              <span>Messages in this thread automatically erase after 30 days.</span>
            </div>

            <div className="chat-messages">
              {messages.length === 0 ? (
                <div className="empty-state" style={{ padding: 32 }}>
                  <span>No active messages. Say hello.</span>
                </div>
              ) : (
                messages.map((m) => {
                  if (m.messageType === 'bill_event') {
                    return (
                      <div key={m.id} className="msg-event-card">
                        <Receipt size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                        <span>{m.body}</span>
                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
                          Erases in {m.daysRemaining}d
                        </div>
                      </div>
                    );
                  }
                  const mine = m.sender.id === currentUser.id;
                  return (
                    <div key={m.id} className={`msg-bubble-wrap ${mine ? 'mine' : 'theirs'}`}>
                      {!mine && activeConv.type === 'group' && (
                        <div style={{ fontSize: 11, marginBottom: 3, paddingLeft: 4 }}>
                          <UsernameBadge user={m.sender} size={11} />
                        </div>
                      )}
                      <div className={`msg-bubble ${mine ? 'mine' : 'theirs'}`}>{m.body}</div>
                      <div className="msg-meta">
                        <span>{formatRelativeTime(m.createdAt)}</span>
                        <span>·</span>
                        <span>erases in {m.daysRemaining}d</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form className="chat-composer" onSubmit={handleSendMessage}>
              <input
                className="hig-input"
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="Message (auto-erases in 30 days)…"
                maxLength={2000}
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={!msgText.trim() || sending}
                style={{ minHeight: 42, width: 44, padding: 0, borderRadius: 999 }}
                aria-label="Send message"
              >
                <Send size={16} strokeWidth={1.8} />
              </button>
            </form>
          </div>
        )}

        {/* BILLS TAB (Groups only) */}
        {activeConv.type === 'group' && groupSubTab === 'bills' && (
          <div style={{ paddingBottom: 24 }}>
            {/* Simplified Settlement Summary */}
            <div className="bill-card">
              <div className="field-label" style={{ marginBottom: 8 }}>
                Simplified Balances
              </div>
              {billsData && billsData.summary.transfers.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {billsData.summary.transfers.map((t, i) => (
                    <div
                      key={`${t.fromUserId}-${t.toUserId}-${i}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong>@{t.fromUser?.username ?? 'member'}</strong>
                        <ArrowRight size={13} className="muted" />
                        <strong>@{t.toUser?.username ?? 'member'}</strong>
                      </div>
                      <span className="mono-num" style={{ fontWeight: 700 }}>
                        {formatMoney(t.amountCents, billsData.bills[0]?.currency || 'USD')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>
                  Everyone in {activeConv.name} is completely settled up.
                </div>
              )}
            </div>

            {/* Individual Bills */}
            {billsData && billsData.bills.length > 0 ? (
              billsData.bills.map((bill) => (
                <div key={bill.id} className="bill-card">
                  <div className="bill-header">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{bill.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        Paid by @{bill.paidBy?.username ?? 'member'} · {bill.splitType} split ·{' '}
                        {formatRelativeTime(bill.createdAt)}
                      </div>
                      {bill.notes && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          {bill.notes}
                        </div>
                      )}
                    </div>
                    <div className="bill-amount">
                      {formatMoney(bill.totalCents, bill.currency)}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    {bill.splits.map((s) => {
                      const canSettle =
                        !s.settled &&
                        (s.userId === currentUser.id || bill.paidByUserId === currentUser.id);
                      return (
                        <div key={s.id} className="split-row">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {s.user ? (
                              <UsernameBadge user={s.user} prefix="@" size={12} />
                            ) : (
                              <span>Member</span>
                            )}
                            {s.userId === bill.paidByUserId && (
                              <span className="tag-chip" style={{ fontSize: 10 }}>
                                Payer
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="mono-num" style={{ fontWeight: 600 }}>
                              {formatMoney(s.owedCents, bill.currency)}
                            </span>
                            {s.settled ? (
                              <span
                                className="muted"
                                style={{
                                  fontSize: 11,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                <Check size={12} /> Settled
                              </span>
                            ) : canSettle ? (
                              <button
                                type="button"
                                className="btn-pill"
                                style={{ minHeight: 26, fontSize: 11, padding: '0 10px' }}
                                onClick={() => handleSettleSplit(bill.id, s.id)}
                              >
                                Settle
                              </button>
                            ) : (
                              <span className="muted" style={{ fontSize: 11 }}>
                                Owes
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Receipt size={26} strokeWidth={1.4} />
                <span>No bills in this group yet.</span>
                <button type="button" className="btn-primary" onClick={openNewBillModal}>
                  Add First Bill
                </button>
              </div>
            )}
          </div>
        )}

        {/* ADD BILL SHEET */}
        {showBillModal && (
          <div className="sheet-backdrop" onClick={() => setShowBillModal(false)}>
            <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-handle" />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 14,
                }}
              >
                <div className="header-title">Split a Group Bill</div>
                <button type="button" className="icon-btn" onClick={() => setShowBillModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateBill} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label className="field-label">Description</label>
                  <input
                    className="hig-input"
                    value={billTitle}
                    onChange={(e) => setBillTitle(e.target.value)}
                    placeholder="Dinner, Taxi, Hotel…"
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
                  <div>
                    <label className="field-label">Total Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="hig-input mono-num"
                      value={billAmount}
                      onChange={(e) => setBillAmount(e.target.value)}
                      placeholder="120.00"
                      required
                    />
                  </div>
                  <div>
                    <label className="field-label">Currency</label>
                    <select
                      className="hig-select"
                      value={billCurrency}
                      onChange={(e) => setBillCurrency(e.target.value)}
                    >
                      {['USD', 'INR', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="field-label">Paid By</label>
                  <select
                    className="hig-select"
                    value={billPaidBy}
                    onChange={(e) => setBillPaidBy(e.target.value)}
                  >
                    {activeConv.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        @{m.username} ({m.displayName})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="field-label">Split Method</label>
                  <div className="segmented">
                    {(['equal', 'exact', 'percentage'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`segmented-btn ${billSplitType === t ? 'active' : ''}`}
                        onClick={() => setBillSplitType(t)}
                        style={{ textTransform: 'capitalize' }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="field-label">Split Among</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activeConv.members.map((m) => {
                      const included = billParticipants.includes(m.id);
                      return (
                        <div
                          key={m.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            padding: '8px 10px',
                            borderRadius: 10,
                            background: 'var(--bg-subtle)',
                          }}
                        >
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={included}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setBillParticipants((p) => [...p, m.id]);
                                } else {
                                  setBillParticipants((p) => p.filter((id) => id !== m.id));
                                }
                              }}
                            />
                            <UsernameBadge user={m} prefix="@" size={12} />
                          </label>

                          {included && billSplitType !== 'equal' && (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="hig-input mono-num"
                              style={{ width: 100, padding: '6px 10px', fontSize: 13 }}
                              placeholder={billSplitType === 'exact' ? '0.00' : '25%'}
                              value={billCustomValues[m.id] ?? ''}
                              onChange={(e) =>
                                setBillCustomValues((prev) => ({ ...prev, [m.id]: e.target.value }))
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="field-label">Notes (Optional)</label>
                  <input
                    className="hig-input"
                    value={billNotes}
                    onChange={(e) => setBillNotes(e.target.value)}
                    placeholder="Includes tip"
                  />
                </div>

                <button type="submit" className="btn-primary">
                  Save Bill Split
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==================== INBOX LIST VIEW ====================
  const visible = conversations.filter((c) => listFilter === 'all' || c.type === listFilter);

  return (
    <div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ flex: 1 }}
            onClick={() => openNewModal('dm')}
          >
            <MessageSquarePlus size={15} strokeWidth={1.6} />
            New Chat
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1, minHeight: 40, fontSize: 13 }}
            onClick={() => openNewModal('group')}
          >
            <Users size={15} strokeWidth={1.6} />
            New Group & Bills
          </button>
        </div>

        <div className="segmented">
          <button
            type="button"
            className={`segmented-btn ${listFilter === 'all' ? 'active' : ''}`}
            onClick={() => setListFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`segmented-btn ${listFilter === 'dm' ? 'active' : ''}`}
            onClick={() => setListFilter('dm')}
          >
            Direct
          </button>
          <button
            type="button"
            className={`segmented-btn ${listFilter === 'group' ? 'active' : ''}`}
            onClick={() => setListFilter('group')}
          >
            Groups & Bills
          </button>
        </div>
      </div>

      <div className="info-banner" style={{ marginTop: 0 }}>
        <Timer size={15} strokeWidth={1.6} />
        <span>Every direct & group message is permanently erased after 30 days.</span>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <span>No conversations here yet.</span>
        </div>
      ) : (
        visible.map((c) => {
          const other =
            c.type === 'dm' ? c.members.find((m) => m.id !== currentUser.id) ?? c.members[0] : null;
          return (
            <button
              key={c.id}
              type="button"
              className="list-row"
              onClick={() => {
                setActiveConvId(c.id);
                setGroupSubTab('chat');
              }}
            >
              {c.type === 'dm' && other ? (
                <Avatar user={other} size={46} showActiveDot />
              ) : (
                <span
                  className="avatar"
                  style={{ width: 46, height: 46, background: 'var(--fill-solid)', color: 'var(--fill-solid-fg)' }}
                >
                  <Users size={18} strokeWidth={1.6} />
                </span>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  {c.type === 'dm' && other ? (
                    <UsernameBadge user={other} />
                  ) : (
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                  )}
                  {c.lastMessage && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {formatRelativeTime(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>

                <div
                  className="muted"
                  style={{
                    fontSize: 13,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.lastMessage
                    ? `${c.type === 'group' ? `@${c.lastMessage.senderUsername}: ` : ''}${c.lastMessage.body}`
                    : c.type === 'dm' && other
                      ? formatPresence(other.isActive, other.lastSeenAt)
                      : `${c.members.length} members`}
                </div>

                {c.type === 'group' && c.openBillsCount > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <span className="tag-chip" style={{ fontSize: 11 }}>
                      <Receipt size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {c.openBillsCount} open {c.openBillsCount === 1 ? 'bill' : 'bills'}
                    </span>
                  </div>
                )}
              </div>
            </button>
          );
        })
      )}

      {/* NEW DM / GROUP SHEET */}
      {showNewModal && (
        <div className="sheet-backdrop" onClick={() => setShowNewModal(null)}>
          <div className="sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div className="header-title">
                {showNewModal === 'dm' ? 'New Direct Message' : 'Create Group & Bill Split'}
              </div>
              <button type="button" className="icon-btn" onClick={() => setShowNewModal(null)}>
                <X size={18} />
              </button>
            </div>

            {showNewModal === 'dm' ? (
              <div>
                {allUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className="list-row"
                    style={{ padding: '10px 4px' }}
                    onClick={() => handleStartDm(u.username)}
                  >
                    <Avatar user={u} size={38} showActiveDot />
                    <div>
                      <UsernameBadge user={u} />
                      <div className="muted" style={{ fontSize: 12 }}>
                        {formatPresence(u.isActive, u.lastSeenAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <form onSubmit={handleCreateGroup} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label className="field-label">Group Name</label>
                  <input
                    className="hig-input"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Weekend Cabin, Roommates…"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Description</label>
                  <input
                    className="hig-input"
                    value={groupDesc}
                    onChange={(e) => setGroupDesc(e.target.value)}
                    placeholder="Chat & shared expenses"
                  />
                </div>
                <div>
                  <label className="field-label">Add Members</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {allUsers.map((u) => {
                      const checked = selectedMembers.includes(u.username);
                      return (
                        <label
                          key={u.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 10px',
                            borderRadius: 10,
                            background: 'var(--bg-subtle)',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedMembers((prev) => [...prev, u.username]);
                              } else {
                                setSelectedMembers((prev) => prev.filter((n) => n !== u.username));
                              }
                            }}
                          />
                          <Avatar user={u} size={28} />
                          <UsernameBadge user={u} prefix="@" size={12} />
                        </label>
                      );
                    })}
                  </div>
                </div>
                <button type="submit" className="btn-primary">
                  Create Group
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
