/** Public progress only. Custody, API credentials and worker recovery identities stay server-side. */
export type ProvisioningStage = 'queued' | 'accounts' | 'register_device' | 'register_policy' | 'complete' | 'unknown';
export type AgentProvisioningProgress = {
  agentId: string;
  status: 'provisioning' | 'active' | 'error' | 'revoked';
  stage: ProvisioningStage;
  state: 'working' | 'pending' | 'complete' | 'failed';
  updatedAt: string;
  transactions: { stage: 'register_device' | 'register_policy'; hash: string }[];
  errorCode: string | null;
  needsReview: boolean;
};
