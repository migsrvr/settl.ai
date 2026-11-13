export interface BannerInfo {
  url: string;
  mcpUrl: string;
  providerKey: string;
  agentKey: string;
  providerUrl: string;
  autoApprove: boolean;
  balancePhp: number;
}

/** What a developer needs after starting the sandbox, ready to paste. */
export function formatBanner(info: BannerInfo): string {
  const approval = info.autoApprove
    ? "Auto-approve is on: the demo agent spends its daily budget without asking a human."
    : `Purchases above the auto-approve limit wait for a human. Approve one with:\n  curl -X POST ${info.url}/api/approvals/<approvalId>/resolve -H "content-type: application/json" -d '{"decision":"approved"}'`;
  return `
Settl sandbox is running. This is fake money on a fake chain: nothing touches Stellar, Velo or a real database.

Gateway     ${info.url}
MCP         ${info.mcpUrl}
Agent       ${info.agentKey}  (fake escrow: PHP ${info.balancePhp})
Services    resibo_parse (PHP 2), resibo_pro (PHP 15), geoph_lookup (PHP 8), expected at ${info.providerUrl}

Provider: set these in the environment of the API you are charging for
  SETTL_API_URL=${info.url}
  SETTL_PROVIDER_KEY=${info.providerKey}

Agent: connect Claude Code
  claude mcp add --transport http settl ${info.mcpUrl} --header "Authorization: Bearer ${info.agentKey}"

Agent: connect Codex, in ~/.codex/config.toml (then export SETTL_AGENT_API_KEY=${info.agentKey})
  [mcp_servers.settl]
  url = "${info.mcpUrl}"
  bearer_token_env_var = "SETTL_AGENT_API_KEY"

${approval}

Data lives in memory and resets when you stop this process. Press Ctrl+C to stop.
`;
}
