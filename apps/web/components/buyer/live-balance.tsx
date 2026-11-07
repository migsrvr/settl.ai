'use client';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Balance } from '@/lib/server/dashboard';
import { money, sum, when } from './live-money';
type Observation = { balance: Balance; checking: boolean; failed: boolean };
type Entry = { state: Observation; listeners: Set<(state: Observation) => void>; request?: Promise<void>; timer?: ReturnType<typeof setInterval>; visibility?: () => void };
const entries = new Map<string, Entry>();
function publish(entry: Entry) { entry.listeners.forEach(listener => listener({ ...entry.state })); }
async function refresh(url: string, entry: Entry) {
  if (entry.request) return entry.request;
  entry.state = { ...entry.state, checking: true, failed: false }; publish(entry);
  entry.request = (async () => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const balance: Balance = await Promise.race([(async () => {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        return response.json() as Promise<Balance>;
      })(), new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Balance refresh timed out')); }, 12_000); })]);
      if ((balance.amountStroops !== null && (typeof balance.amountStroops !== 'string' || !/^\d+$/.test(balance.amountStroops))) || !['chain', 'cache', 'unavailable'].includes(balance.source) || (balance.asOf !== null && (typeof balance.asOf !== 'string' || !Number.isFinite(Date.parse(balance.asOf))))) throw new Error();
      entry.state = { balance, checking: false, failed: balance.source === 'unavailable' };
    } catch { entry.state = { ...entry.state, checking: false, failed: true }; }
    finally { clearTimeout(timeout); entry.request = undefined; publish(entry); if (!entry.listeners.size && entries.get(url) === entry) entries.delete(url); }
  })();
  return entry.request;
}
export function useLiveBalance(url: string, initial: Balance) {
  const seed = useMemo<Observation>(() => ({ balance: initial, checking: initial.amountStroops === null, failed: false }), [initial]);
  const subscribe = useCallback((listener: () => void) => {
    let entry = entries.get(url);
    if (!entry) { entry = { state: seed, listeners: new Set() }; entries.set(url, entry); }
    const current = entry;
    current.listeners.add(listener);
    if (!current.timer) {
      const check = () => { if (document.visibilityState === 'visible') void refresh(url, current); };
      current.visibility = check; document.addEventListener('visibilitychange', check);
      current.timer = setInterval(check, 30_000); check();
    }
    return () => { current.listeners.delete(listener); if (!current.listeners.size) { clearInterval(current.timer); current.timer = undefined; if (current.visibility) document.removeEventListener('visibilitychange', current.visibility); current.visibility = undefined; if (!current.request) entries.delete(url); } };
  }, [url, seed]);
  const getSnapshot = useCallback(() => entries.get(url)?.state ?? seed, [url, seed]);
  const getServerSnapshot = useCallback(() => seed, [seed]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...state, refresh: () => { const entry = entries.get(url); return entry ? refresh(url, entry) : Promise.resolve(); } };
}
export function BalanceObservation({ balance, checking, failed }: Observation) {
  return <span className="text-muted">{balance.asOf ? `Observed as of ${when(balance.asOf)}.` : checking ? 'Checking balance…' : balance.amountStroops !== null ? 'Observation time unavailable.' : 'Balance unavailable.'}{failed ? ' Live balance unavailable. Refresh to try again.' : ''}</span>;
}
export function LiveBalance({ url, initial, rateCents }: { url: string; initial: Balance; rateCents: string | null }) {
  const state = useLiveBalance(url, initial);
  return <div><span>{state.balance.amountStroops === null && state.checking ? 'Checking balance…' : money(state.balance.amountStroops, rateCents)}</span>{(state.balance.asOf || !state.checking) && <div><BalanceObservation {...state}/></div>}</div>;
}
type BudgetAgent = { id: string; balance: Balance };
export function LiveBudgetTotal({ agents, rateCents }: { agents: BudgetAgent[]; rateCents: string | null }) {
  return <BudgetGroup key={agents.map(agent => agent.id).join(':')} agents={agents} rateCents={rateCents}/>;
}
function BudgetGroup({ agents, rateCents }: { agents: BudgetAgent[]; rateCents: string | null }) {
  const [observations, setObservations] = useState<Record<string, Observation>>(() => Object.fromEntries(agents.map(agent => [agent.id, { balance: agent.balance, checking: agent.balance.amountStroops === null, failed: false }])));
  const update = useCallback((id: string, observation: Observation) => setObservations(previous => ({ ...previous, [id]: observation })), []);
  const current = agents.map(agent => observations[agent.id]);
  const unknown = current.filter(observation => observation.balance.amountStroops === null);
  return <>{agents.map(agent => <BudgetPart key={agent.id} agent={agent} onChange={update}/>)}{unknown.length ? unknown.some(observation => observation.checking) ? 'Checking balance…' : 'Unavailable' : money(sum(current.map(observation => observation.balance.amountStroops!)), rateCents)}</>;
}
function BudgetPart({ agent, onChange }: { agent: BudgetAgent; onChange: (id: string, observation: Observation) => void }) {
  const { balance, checking, failed } = useLiveBalance(`/api/agents/${encodeURIComponent(agent.id)}/balance`, agent.balance);
  useEffect(() => { onChange(agent.id, { balance, checking, failed }); }, [agent.id, balance, checking, failed, onChange]);
  return null;
}
