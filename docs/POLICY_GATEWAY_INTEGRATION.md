# Policy Gateway Integration Contract (P0)

Status: proposed integration contract; **not a deployed Prism/VibeGuard runtime adapter**.

## Verified repositories and boundaries

- [Prism](https://github.com/jaminliu89/prism): product planning, evidence audit, Foundry and Mission local tools. Its README explicitly does **not** promise an autonomous model scheduler, remote agent execution, or an always-on policy decision service.
- [Prism Bridge](https://github.com/jaminliu89/prism-bridge): separate local MCP/command bridge; execution uses the current OS user and is not an OS sandbox.
- [VibeGuard](https://github.com/jaminliu89/vibeguard): independent coding guardrail product with local `vg` CLI, MCP, git hooks, CI gate-token audit. Do not present it as a SkillHub submodule or assume a network policy API exists.
- [Local Control Plane](https://github.com/jaminliu89/local-control-plane): local broker, editor/MCP adapters, declared commands, workspace edits and timeline; **currently no mandatory external policy gateway**.

## Enforcement contract

All entry points (REST, MCP, extension, DSH) MUST converge on the broker's single side-effect boundary before invoking a write or execution primitive. Mandatory coverage: `edit`, `terminal`, `verify`, `perform_ax`. Assess `capture_window` separately for privacy consent. `observe`/`observe_ui` are read-only but may expose private data and need access controls. `trace` is an audit write and must not forge approvals.

Decision inputs: `taskId`, `traceId`, `workspaceRealpath`, `actorIdentity` (authenticated, not user-supplied `actor` text), `entryPoint`, `verb`, `operationDigest`, `policyVersion`, `routeDecisionId`, `idempotencyKey`, `requestedCapabilities`. Never treat untrusted model input as an approval.

Decision outputs: `ALLOW | DENY | REQUIRE_APPROVAL`, `decisionId`, `reasonCode`, `policyVersion`, `expiresAt`, `evidenceDigest`. Approval must bind the exact operation digest, task, workspace, policy version and authenticated human identity; stale approval is invalid.

Prism provides **route/plan advice**, not final security authorization. VibeGuard owns independent code-safety gates and can veto. A gateway enforces the combination: `Prism route + policy + VibeGuard decision + human approval if required`. No circular delegation: maximum hop count, parent task lineage, idempotent operation ID and no self-approval. The broker MUST revalidate immediately before executing, not only at UI presentation.

## Failure rules

For side effects, unavailable/unconfigured Prism routing or VibeGuard enforcement MUST NOT silently become `ALLOW`. Until real adapters are implemented and tested, keep existing behavior marked **legacy/unguarded**; do not claim this document retroactively secures it. Rollout should be explicit and fail-closed for any workspace enrolled in enforced mode. Existing installations require a migration plan to avoid unexpected data loss.

Declared `.controlplane/commands.json` is an argv allowlist, **not** a trust boundary; `spawn(shell:false)` is not sandboxing, and currently inherits `process.env`. Audit declared executable provenance, environment exposure, network/filesystem privileges and process cancellation before granting execution.

## Delivery slices

1. Introduce versioned policy decision types and a pure decision evaluator with deny/approval/allow tests.
2. Add broker-side enforcement for every side-effect verb, and negative tests through every transport; never rely on client UI checks.
3. Implement an authenticated Prism capability/route adapter against **verified** local interfaces, without inventing an API.
4. Implement a VibeGuard CLI/MCP adapter against **verified** commands, with timeout, veto and fail-closed tests; preserve independent product ownership.
5. Bind decision/evidence IDs to timeline, add doctor diagnostics and panel status, then CI negative-path and genuine multi-repo E2E.

## Acceptance evidence

A successful unit test is not a cross-repo integration test. Record separately: source inspected, adapter implemented, unit tests passed, CI passed, independent review, live E2E (including denial and bypass attempts), and authorized merge. Never label a mocked response as a real Prism or VibeGuard verdict.

Tracks [Issue #1](https://github.com/jaminliu89/local-control-plane/issues/1).
