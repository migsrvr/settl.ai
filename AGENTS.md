# Agent instructions: Settl.ai

Start with [`HANDOFF.md`](HANDOFF.md). It covers the current state, the next tasks in order, the Noir and Velo facts, and the gotchas.

## Rules
- **npm workspaces only.** pnpm isn't installed. Run commands from the repo root.
- **Before calling work done**, run `npm test && npm run typecheck && npm run lint && npm run build`, and say plainly if anything fails.
- **Write tests before code.** Vitest; server-side tests start with `// @vitest-environment node`.
- **Next.js 16 has breaking changes.** Read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before using an API.
- **The backend design** lives in `docs/superpowers/specs/2026-11-04-settl-api-mcp-design.md`. It overrides older docs where they differ.
- **UI work** follows the visual system in `docs/superpowers/specs/2026-11-03-settl-ui-design.md` §2, using the tokens in `apps/web/app/globals.css`.
- **Don't** commit, push or switch branches unless the user asks. Never commit secrets.
- **When a decision changes**, update `HANDOFF.md` and the revision note in `docs/superpowers/plans/2026-11-03-settl.md`.
