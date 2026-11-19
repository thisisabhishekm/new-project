export type SplitType = 'equal' | 'exact' | 'percentage';

export interface SplitInput {
  totalCents: number;
  splitType: SplitType;
  participantIds: string[];
  exactCents?: Record<string, number>;
  percentages?: Record<string, number>;
}

export interface ComputedSplit {
  userId: string;
  owedCents: number;
}

/**
 * Cent-accurate bill splitting engine.
 * Guarantees sum(owedCents) === totalCents with zero floating-point drift.
 */
export function computeBillSplits(input: SplitInput): ComputedSplit[] {
  const { totalCents, splitType, participantIds, exactCents, percentages } = input;

  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error('Bill total must be a positive integer in minor currency units.');
  }

  const uniqueParticipants = [...new Set(participantIds)];
  if (uniqueParticipants.length < 1) {
    throw new Error('At least one participant is required to split a bill.');
  }

  if (splitType === 'equal') {
    const count = uniqueParticipants.length;
    const base = Math.floor(totalCents / count);
    const remainder = totalCents - base * count;
    return uniqueParticipants.map((userId, index) => ({
      userId,
      owedCents: base + (index < remainder ? 1 : 0),
    }));
  }

  if (splitType === 'exact') {
    if (!exactCents) {
      throw new Error('Exact amounts are required for exact splits.');
    }
    let sum = 0;
    const result: ComputedSplit[] = [];
    for (const userId of uniqueParticipants) {
      const amount = exactCents[userId];
      if (!Number.isInteger(amount) || amount < 0) {
        throw new Error(`Invalid exact amount for participant ${userId}.`);
      }
      sum += amount;
      result.push({ userId, owedCents: amount });
    }
    if (sum !== totalCents) {
      throw new Error(`Exact split amounts (${sum}) must sum to total (${totalCents}).`);
    }
    return result;
  }

  if (splitType === 'percentage') {
    if (!percentages) {
      throw new Error('Percentages are required for percentage splits.');
    }
    let pctSum = 0;
    for (const userId of uniqueParticipants) {
      const pct = percentages[userId];
      if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error(`Invalid percentage for participant ${userId}.`);
      }
      pctSum += pct;
    }
    if (Math.abs(pctSum - 100) > 0.01) {
      throw new Error(`Percentages must total 100% (received ${pctSum.toFixed(2)}%).`);
    }

    // Largest-remainder method so rounding always hits totalCents exactly
    const raw = uniqueParticipants.map((userId) => {
      const exact = (totalCents * percentages[userId]) / 100;
      const floored = Math.floor(exact);
      return { userId, floored, frac: exact - floored };
    });

    const allocated = raw.reduce((acc, r) => acc + r.floored, 0);
    let remainder = totalCents - allocated;

    const sortedByFrac = [...raw].sort((a, b) => b.frac - a.frac);
    const bonusSet = new Set<string>();
    for (let i = 0; i < remainder; i++) {
      bonusSet.add(sortedByFrac[i].userId);
    }

    return raw.map((r) => ({
      userId: r.userId,
      owedCents: r.floored + (bonusSet.has(r.userId) ? 1 : 0),
    }));
  }

  throw new Error(`Unsupported split type: ${String(splitType)}`);
}

export interface UnsettledSplitRecord {
  paidByUserId: string;
  debtorUserId: string;
  owedCents: number;
}

export interface SimplifiedTransfer {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export interface GroupBalanceSummary {
  netBalances: Record<string, number>; // positive = owed money, negative = owes money
  transfers: SimplifiedTransfer[];
}

/**
 * Computes net balances and simplifies group debts into the minimal number of transfers.
 */
export function simplifyGroupDebts(
  memberIds: string[],
  unsettledSplits: UnsettledSplitRecord[]
): GroupBalanceSummary {
  const netBalances: Record<string, number> = {};
  for (const id of memberIds) {
    netBalances[id] = 0;
  }

  for (const split of unsettledSplits) {
    if (split.debtorUserId === split.paidByUserId || split.owedCents <= 0) {
      continue;
    }
    netBalances[split.paidByUserId] = (netBalances[split.paidByUserId] ?? 0) + split.owedCents;
    netBalances[split.debtorUserId] = (netBalances[split.debtorUserId] ?? 0) - split.owedCents;
  }

  const creditors: Array<{ userId: string; amount: number }> = [];
  const debtors: Array<{ userId: string; amount: number }> = [];

  for (const [userId, balance] of Object.entries(netBalances)) {
    if (balance > 0) creditors.push({ userId, amount: balance });
    else if (balance < 0) debtors.push({ userId, amount: -balance });
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transfers: SimplifiedTransfer[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const settled = Math.min(creditor.amount, debtor.amount);

    if (settled > 0) {
      transfers.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountCents: settled,
      });
    }

    creditor.amount -= settled;
    debtor.amount -= settled;

    if (creditor.amount === 0) ci++;
    if (debtor.amount === 0) di++;
  }

  return { netBalances, transfers };
}
