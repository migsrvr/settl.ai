# Settl MCP for agents that do not guess: design

Status: approved by the user on 2026-11-11 (plan mode). Plan: `docs/superpowers/plans/2026-11-11-settl-mcp.md`.

## Problem
Agents on the hosted MCP see a service's name and price but not what input it takes; per-call billing charges even when the provider rejects bad input. Every failure is `TOOL_FAILED`. `settl_call` returns internal `effects` and declares no output shape. Approvals can only be polled, budget reads hit the chain each time, and nothing advertises the gateway or helps a buyer connect a client.

## Decisions
- **Additive only.** The six `settl_*` tools, their argument shapes and the string `error` field stay. New things are extra fields and extra tools, so `apps/agent`, `@settl/client`, the demo scripts and existing tests keep working.
- **Service metadata on Endpoint:** optional `description`, `inputSchema` (JSON Schema, object root) and `example`. Shipped to Neon as a hand-written idempotent SQL file that the user applies before deploying; never applied by the agent.
- **Validate input before money moves.** When a service declares an input schema, the broker refuses non-matching input as `declined / invalid_input` before any quote, nonce or authorization.
- **Typed per-service tools** are generated per request from a 30-second in-process catalog cache, named `<provider>_<name>` slugs, capped at 40, built with the SDK's `fromJsonSchema`. A schema that fails to compile skips that tool only.
- **Errors:** only `BrokerError` codes on an allow-list are exposed, each with `message`, `next` and `retryable`. Anything else stays redacted as `TOOL_FAILED`.
- **Typed `settl_call` output:** one object schema with a `status` enum (a union root would be wrapped on older wires). Built field by field, so `effects` and unknown fields never leave the server.
- **Approvals:** `settl_wait_for_approval` waits server-side up to 55 s. MCP elicitation is not available in the stateless legacy mode this server uses.
- **Budget:** reuses the 15-second balance snapshot service; authorization never reads it.
- **Discovery:** `/llms.txt`, a server card at the path of the current MCP server-card proposal (marked as non-final), MCP resources `settl://services` and `settl://guide`, and a `buy_service` prompt.
- **Connect panel:** dashboard copy-paste config for Claude Code, Codex, Cursor and `@settl/client`; the key is filled in only on the creation screen because only its hash is stored.

## Out of scope
Per-provider keys, URL ownership proof, x402 interop, publishing packages, deploying, and applying the SQL to Neon.
