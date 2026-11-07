import type { AgentProvisioningProgress, ProvisioningStage } from '../agent-provisioning';
import { ApiError, isObject } from './api-auth';
import { getDb } from './db';
import { readProvisioningCheckpoint } from './agent-provisioning-checkpoint';

const STAGES: ProvisioningStage[] = ['queued', 'accounts', 'register_device', 'register_policy', 'complete'];
export async function readAgentProvisioning(orgId: string, id: string): Promise<AgentProvisioningProgress> {
  const agent = await getDb().agent.findFirst({ where: { id, orgId }, select: { id: true, status: true, updatedAt: true, lifecycleRecovery: true } });
  if (!agent) throw new ApiError(404, 'agent_not_found');
  const checkpoint = isObject(agent.lifecycleRecovery) ? agent.lifecycleRecovery : {};
  const parsed = readProvisioningCheckpoint(checkpoint);
  const managed = parsed !== null && parsed.automaticRecoveryBlocked !== true;
  const active = agent.status === 'active';
  const terminal = agent.status === 'error' || agent.status === 'revoked';
  const stage = active ? 'complete' : STAGES.includes(checkpoint.stage as ProvisioningStage) ? checkpoint.stage as ProvisioningStage : 'unknown';
  const state = active ? 'complete' : terminal ? 'failed' : !managed ? 'pending' : checkpoint.state === 'pending' || checkpoint.state === 'failed' ? checkpoint.state : 'working';
  const missingIdentity = (stage === 'register_device' || stage === 'register_policy') && !parsed?.transactions.some(tx => tx.stage === stage);
  const needsReview = !active && !terminal && (!managed || stage === 'unknown' || stage === 'complete' || state === 'failed' || missingIdentity || checkpoint.needsReview === true);
  const transactions: AgentProvisioningProgress['transactions'] = [];
  if (Array.isArray(checkpoint.transactions)) for (const transaction of checkpoint.transactions) {
    if (isObject(transaction) && (transaction.stage === 'register_device' || transaction.stage === 'register_policy') && typeof transaction.hash === 'string' && /^[a-f0-9]{64}$/i.test(transaction.hash)) {
      transactions.push({ stage: transaction.stage, hash: transaction.hash });
    }
  }
  return {
    agentId: agent.id, status: agent.status, stage, state, updatedAt: parsed?.updatedAt ?? agent.updatedAt.toISOString(), transactions,
    needsReview, errorCode: needsReview ? 'reconciliation_required' : state === 'failed' ? 'setup_failed' : state === 'pending' ? 'awaiting_confirmation' : null,
  };
}
