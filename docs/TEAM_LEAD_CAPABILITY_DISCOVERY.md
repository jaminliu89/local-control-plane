# Team Lead Capability Discovery (P0)

Status: architecture contract; **not an implemented autonomous dispatcher**. Companion to [Policy Gateway](POLICY_GATEWAY_INTEGRATION.md) and [Issue #1](https://github.com/jaminliu89/local-control-plane/issues/1).

## Roles and authority

- **Founder**: owns goal, scope and exceptional approvals.
- **Prism**: recommends task decomposition, owner, routing and capability composition; see its actual [INTEGRATION](https://github.com/jaminliu89/prism/blob/main/docs/INTEGRATION.md). Do not mistake its CLI/Mission contracts for an always-on scheduler.
- **Team lead Agent**: accountable for the outcome; MUST discover existing assets before creating a worker task or proposing new code. Only the team lead assigns and reassigns work; workers return results and blockers to the lead. This is one-way *command authority*, not one-way information.
- **Specialist workers**: execute a scoped contract and return evidence; no delegation, permission escalation or self-certification without explicit capability grants.
- **SkillHub**: canonical `SKILL_REGISTRY.yaml` and `scripts/hub.py route` provide discoverable candidate skills. Its CLI ranks candidates; it is **not** a semantic oracle or proof that a tool is installed or callable. `engineering-agent-os/SKILL_ROUTER.yaml` offers task-type suggestions.
- **VibeGuard**: independent gate authority for code-development workflows. The lead cannot forge `vg approve` or `vg bypass`.
- **Local Control Plane**: authenticated broker/execution and evidence surfaces; future enforcement must be at the broker boundary, not merely in the lead's prompt.

## Mandatory discovery before delegation

1. **Recover task context**: target repository, revision, canonical `PROJECT.yaml` / `TASKS.yaml` where present, task goal, acceptance and authorized side effects.
2. **Find candidates**: read the current SkillHub Registry and run `hub route '<intent>'` when installed; inspect `SKILL_ROUTER.yaml` and known independent repositories as candidates. Preserve the original PRIMARY owner and supporting-only distinctions.
3. **Verify reality**: for each candidate, inspect the owning repository's pinned version, interface (CLI/MCP/API/Skill), installed state, auth requirements, environment and a safe read-only probe where authorized. A repository URL or Skill markdown alone is not execution evidence.
4. **Select action**: REUSE existing verified capability; COMPOSE several verified capabilities; ADAPT with an explicitly scoped adapter; BUILD_NEW only if the gap is proven. Do not silently fork an independent product into the panel.
5. **Publish assignment**: one accountable lead, worker task IDs, dependencies, allowed files, required skills, policy/approval checks, acceptance tests and evidence. Prefer independent worktrees for parallel code edits.
6. **Reconcile**: worker reports DONE/BLOCKED/FAILED with commit, test output and artifacts; lead validates the evidence, then submits the result to independent quality and security gates. Never convert a missing worker report into success.

## Minimal machine-readable discovery receipt (proposal)

```json
{
  "taskId": "TASK-001",
  "leadId": "lead-engineering",
  "targetRepo": "owner/repo",
  "targetRevision": "commit-sha",
  "registryRevision": "commit-sha",
  "primaryOwner": "engineering-agent-os",
  "candidates": [
    {
      "assetId": "vibeguard",
      "sourceRepo": "owner/vibeguard",
      "interface": "cli",
      "status": "DISCOVERED_NOT_CONNECTED",
      "evidence": ["repository-readme-at-revision"],
      "decision": "ADAPT",
      "reason": "Local execution/authorization not verified"
    }
  ],
  "missingCapabilities": ["verified-runtime-gate-adapter"],
  "delegations": [],
  "nextAction": "verify actual local CLI and authorization"
}
```

Candidate status enum: `UNKNOWN | DISCOVERED_NOT_CONNECTED | VERIFIED_AVAILABLE | BLOCKED | UNSUPPORTED`. Decision enum: `REUSE | COMPOSE | ADAPT | BUILD_NEW | DEFER`. Do not infer `VERIFIED_AVAILABLE` from README or unit-test existence. Evidence must include revision and probe outcome; do not log secrets.

## Negative cases to test before runtime rollout

- Registry matches a Skill but owning repo is inaccessible: report BLOCKED, do not invent invocation.
- Two agents propose the same change: only one lead may assign ownership; others submit proposals.
- Worker lacks automation: inspect existing Prism Bridge, Dock and MCP adapters before building another runner; verify actual callable interfaces.
- Worker lacks guardrail: route to independently enforced VibeGuard gate; if unavailable, do not mark protected execution as authorized.
- Worker calls another worker directly: reject unauthorized delegation, return to lead.
- Route loops or repeated requests: task lineage, max hops, idempotency and cancellation required.
- Worker reports tests passed without logs: do not mark DONE.

## Implementation boundary

This file is a handoff contract for a future team-lead dispatcher and panel UI. It does not install SkillHub, spawn workers, connect Prism or enforce VibeGuard. Runtime implementation requires separate PRs, broker negative-path tests, independent review and real E2E evidence.
