# Settl.ai submission materials

Prepared November 7, 2026 against the supplied **Velo x Noir Agentic Payment Hackathon - Builder Handbook**, updated November 5. The handbook supplies submission requirements, not authorization to register, submit forms or publish changes.

## Deliverables

- Public monorepo: [github.com/migsrvr/settl.ai](https://github.com/migsrvr/settl.ai). GitHub metadata confirmed public visibility during this preparation.
- Live website: [settl-ai-pi.vercel.app](https://settl-ai-pi.vercel.app). Provider and buyer pages loaded during screenshot capture.
- [Judging README](../README.md): the exact 13 required level-two headings in handbook order.
- [Editable pitch deck](pitch/settl-ai-pitch.pptx): eight main slides plus two hidden Q&A appendix slides, with timed speaker notes. [Speaking and recording guide](pitch/PITCH_GUIDE.md).
- [Actual website screenshots](assets/): testnet demo data, without secret keys or API tokens.
- Team supplied by the user: **Miggy Rivera**, Discord **`_ra1ve`**. Registration status has not been checked.
- **Two-minute video: not recorded or linked yet.** The recording guide does not replace the required video.

No commit, push, branch switch, registration/submission form, new payment, funding, claim or top-up reconciliation is part of this preparation.

## Handbook mapping

The root README follows: Problem; Solution; How the agentic payment works; Architecture; Noir integration; Velo integration; Testnet proof; Repo structure; Run it locally; Environment variables; Screenshots; What's next; Credits. Its header includes the live URL, the missing-video status and the user-supplied team identity.

| Judging criterion | Weight | Evidence and pitch location |
| --- | --- | --- |
| Agentic payments fit | 30% | Agent chooses/request tools through MCP, slides 3-5 and README payment steps |
| Technical execution | 25% | Actual adapter/callback source links, contract IDs and historical hashes, slide 6 and appendix |
| Innovation | 20% | One gateway combines agent requests, provider billing, budgets, receipts and optional result checks |
| Real-world potential | 15% | API-provider/agent-operator target and explicitly unvalidated business model, slide 7 |
| Pitch and demo | 10% | Five-minute timing including 90-second demo, actual testnet screens and recording guide |

## Remaining submission items

1. Record and upload a two-minute video, then replace the README's missing-video line with the real URL. Capture a real agent request and actual returned payment status. Show its receipt/hash; do not present `/stage` as payment evidence.
2. Review the local files, then explicitly authorize their commit/push if desired. Repository AGENTS.md prohibits committing or pushing unless the user asks. Existing unrelated performance changes must not be swept into this documentation release.
3. Resolve the original hosted paid-checkout reconciliation separately. The observed Codex agent page still lists pending budget loads alongside a completed load; no association between a particular load and a Velo callback was established here.
4. Rehearse the hosted per-call demo under its actual current policy and provider configuration. Do not repeat unknown/pending operations or use a new payment to replace an unresolved one.
5. Verify registration and the organizer's current submission form/deadline directly. No form was submitted here.

## Deadline conflict

The supplied handbook, pages 1-2 and 11, says **Saturday, November 7, 2026 at 12:00 PM Philippine time (UTC+8)**. It lists the top 10 announcement at 4:00 PM that day and the live pitch on November 8 at 1:00 PM. Older project handoff notes say submission closes **November 8 at 8:00 AM** and a different top-10 time. Preserve this as an unresolved source conflict until a later official organizer update is supplied. The pitch format in the supplied handbook is **five minutes including a live demo, followed by three minutes of Q&A**.
