'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgentProvisioningProgress } from '@/lib/agent-provisioning';
import { txUrl } from './live-money';

const stages = [
  ['queued', 'Queued'], ['accounts', 'Preparing wallets'],
  ['register_device', 'Registering device'], ['register_policy', 'Registering spending limits'],
  ['complete', 'Ready'],
] as const;
const isVisible = () => document.visibilityState !== 'hidden';

function validProgress(value: unknown, agentId: string): value is AgentProvisioningProgress {
  if (!value || typeof value !== 'object') return false;
  const data = value as AgentProvisioningProgress;
  return data.agentId === agentId && ['provisioning', 'active', 'error', 'revoked'].includes(data.status)
    && ['queued', 'accounts', 'register_device', 'register_policy', 'complete', 'unknown'].includes(data.stage)
    && ['working', 'pending', 'complete', 'failed'].includes(data.state)
    && typeof data.updatedAt === 'string' && typeof data.needsReview === 'boolean'
    && (data.errorCode === null || typeof data.errorCode === 'string')
    && Array.isArray(data.transactions) && data.transactions.every(tx => tx && ['register_device', 'register_policy'].includes(tx.stage) && typeof tx.hash === 'string');
}

export function ProvisioningProgress({ agentId }: { agentId: string }) {
  const { refresh } = useRouter();
  const [snapshot, setProgress] = useState<AgentProvisioningProgress | null>(null);
  const progress = snapshot?.agentId === agentId ? snapshot : null;
  const [unavailable, setUnavailable] = useState(false);
  const refreshed = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let terminal = false;
    let generation = 0;
    let polling: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;

    async function read() {
      if (disposed || terminal || !isVisible() || cancel) return;
      const current = ++generation;
      const controller = new AbortController();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => { controller.abort(); reject(new Error('Status read cancelled')); };
        deadline = setTimeout(() => cancel?.(), 10_000);
      });
      try {
        const data: unknown = await Promise.race([
          (async () => {
            const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/provisioning`, { method: 'GET', cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('Status unavailable');
            return response.json();
          })(), cancelled,
        ]);
        if (disposed || generation !== current) return;
        if (!validProgress(data, agentId)) throw new Error('Invalid status');
        setProgress(data); setUnavailable(false);
        terminal = data.status !== 'provisioning';
        if (data.status === 'active' && refreshed.current !== agentId) { refreshed.current = agentId; refresh(); }
      } catch {
        if (!disposed && generation === current) setUnavailable(true);
      } finally {
        clearTimeout(deadline);
        if (generation === current) {
          cancel = undefined;
          if (!disposed && !terminal && isVisible()) polling = setTimeout(read, 2000);
        }
      }
    }
    function visibilityChanged() {
      clearTimeout(polling);
      if (!isVisible()) { generation++; cancel?.(); cancel = undefined; }
      else void read();
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    void read();
    return () => { disposed = true; generation++; clearTimeout(polling); cancel?.(); document.removeEventListener('visibilitychange', visibilityChanged); };
  }, [agentId, refresh]);

  return <section className="flex min-w-0 flex-col gap-4" aria-label="Agent registration progress">
    <div role="status" aria-live="polite">
      <h2 className="text-lg font-medium">{progress?.status === 'active' ? 'Agent ready' : progress?.status === 'error' ? 'Registration failed' : progress?.status === 'revoked' ? 'Agent revoked' : 'Registration pending'}</h2>
      {unavailable ? <p>Status is unavailable. We will check again. You can also review the agent list before taking further action.</p>
        : progress?.needsReview ? <p>Needs review. Registration is not confirmed. Review the agent status before making payments.</p>
        : progress?.state === 'pending' ? <p>Awaiting confirmation. Registration is not complete. You can leave this page while confirmation continues.</p>
        : progress?.status === 'error' ? <p>Registration could not finish. Review the agent status before creating another agent.</p>
        : progress?.status === 'revoked' ? <p>This agent cannot make payments.</p>
        : progress?.status === 'active' ? <p>Registration is confirmed. You can load a budget to start.</p>
        : <p>Preparing your agent. You can leave this page and check its status from the agent list.</p>}
      {progress?.needsReview && progress.state === 'pending' && <p>Awaiting confirmation.</p>}
    </div>
    <ol className="flex flex-wrap gap-x-6 gap-y-3" aria-label="Registration stages">
      {stages.map(([stage, label]) => <li key={stage} aria-current={progress?.stage === stage && (stage !== 'complete' || progress.status === 'active') ? 'step' : undefined} className={progress?.stage === stage ? 'font-medium' : 'text-ink-2'}>{label}</li>)}
    </ol>
    {progress?.stage === 'unknown' && <p>The current registration stage is unavailable. Review the agent status before taking further action.</p>}
    {!!progress?.transactions.length && <ul className="flex flex-col gap-2">{progress.transactions.map(tx => <li key={`${tx.stage}-${tx.hash}`} className="min-w-0"><span>{tx.stage === 'register_device' ? 'Device transaction' : 'Spending limits transaction'}</span><a href={txUrl(tx.hash)} target="_blank" rel="noreferrer" className="block break-all font-mono">{tx.hash}<span className="sr-only"> (opens in a new tab)</span></a></li>)}</ul>}
  </section>;
}
