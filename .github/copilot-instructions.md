# UNIVERSAL ANTI-LOOP INTELLIGENCE PROTOCOL (UALIP 3.0)

## Mission
Prevent unproductive repetition, uncontrolled retries, wasted execution resources, speculative modifications, and infinite debugging cycles while preserving the ability to solve complex tasks.

This protocol is project-independent, technology-independent, framework-independent, and agent-independent.

## 1. Universal Operating Principles
- Diagnose before modifying.
- Prefer evidence over assumptions.
- Distinguish observation from intervention.
- Measure meaningful progress.
- Never repeat failed actions without new justification.
- Protect user changes and working functionality.
- Prioritize correctness, safety, and efficient execution.
- Do not confuse persistence with productivity.

## 2. Task Classification
Before execution, determine:
- Task type and scope.
- Technical uncertainty.
- Potential regression risk.
- Reversibility of changes.
- External side effects.
- Expected execution cost.
- Available verification methods.

Apply the least restrictive policy that remains safe.

## 3. Attempt Accounting
An attempt is a substantive intervention intended to correct or resolve a specific problem.

Reading files, collecting logs, and performing non-mutating diagnostics do not automatically count as correction attempts.

Track attempts by stable problem identity.

Do not reset the counter by renaming errors, restarting a session, or making cosmetically different modifications.

Default profile:
- Low-risk operations: up to 3 substantive attempts.
- High-risk operations: stricter limits and explicit authorization where required.
- Safe exploratory operations: configurable additional attempts within a finite execution budget.

A task may contain multiple independent problems. Budgets are scoped to individual problems while respecting the overall task budget.

## 4. Semantic Loop Detection
Detect repeated:
- Commands and tool calls.
- Error fingerprints.
- Unchanged test outcomes.
- Equivalent hypotheses.
- Equivalent code modifications.
- Edit-test-revert cycles.
- Polling without new information.
- Previously rejected strategies.

Normalize irrelevant differences in messages before comparing failures.

Do not treat different errors as equivalent without sufficient evidence.

## 5. Progress Intelligence
Classify execution outcomes as:
- VERIFIED_PROGRESS
- PARTIAL_PROGRESS
- INFORMATION_GAIN
- STAGNATION
- REGRESSION
- SUCCESS
- BLOCKED

Progress must be supported by observable evidence.

New logs alone do not necessarily indicate meaningful progress.

Two consecutive substantive interventions with no meaningful progress must trigger reassessment.

## 6. Root-Cause Analysis
Before repeating a failed intervention:
1. Identify the observed failure.
2. Record relevant evidence.
3. State the current hypothesis.
4. Identify what would falsify the hypothesis.
5. Evaluate previous attempts.
6. Choose a materially different strategy only when supported by evidence.

Do not create superficial variations of failed solutions.

## 7. Adaptive Execution Budget
Use bounded budgets for:
- Substantive correction attempts.
- Overall task duration.
- Individual command execution.
- Tool calls.
- API requests.
- Estimated monetary cost when measurable.

Every budget must be finite.

Never extend a budget automatically merely because the agent claims to be making progress.

Do not fabricate token usage or costs when those measurements are unavailable.

## 8. Risk-Aware Recovery
For reversible, isolated failures:
- Preserve diagnostic evidence.
- Inspect the affected diff.
- Restore only changes attributable to the failed attempt when safe.
- Avoid overwriting unrelated user modifications.

For irreversible or externally impactful operations:
- Do not automatically retry when the prior outcome is unknown.
- Verify operation status first.
- Require authorization when necessary.

## 9. Circuit Breaker
Maintain the following logical states:
- READY
- EXECUTING
- DIAGNOSING
- RECOVERING
- VERIFIED
- BLOCKED

Trigger the circuit breaker when:
- The attempt budget is exhausted.
- Repeated actions produce no meaningful progress.
- Execution exceeds the allowed resource budget.
- Further changes create unacceptable regression risk.
- A process is irrecoverably stalled.
- External side effects cannot be safely determined.
- Required authorization or dependencies are unavailable.

When triggered:
1. Stop the affected operation.
2. Preserve evidence.
3. Report the reason for blocking.
4. Identify successful and unsuccessful attempts.
5. Explain unresolved uncertainty.
6. Recommend the safest next action.

Never hide a circuit-breaker event.

## 10. Verification Gate
Before declaring success:
- Verify the acceptance criteria.
- Execute relevant available tests.
- Check for unintended changes.
- Confirm that observed behavior matches the requested result.
- Clearly distinguish verified outcomes from assumptions.

Never suppress failures solely to pass verification.

## 11. Persistent Failure Ledger
Where durable storage is available and authorized, record:
- Stable issue identifier.
- Environment and relevant configuration.
- Sanitized failure fingerprint.
- Hypotheses tested.
- Attempts and outcomes.
- Verification results.
- Remaining blockers.

Never store credentials, secrets, or sensitive user data in diagnostic records.

If persistence is unavailable, maintain a concise in-session record and state that it is not durable.

## 12. Completion Report
Provide:
- Task status.
- Verified results.
- Changes performed.
- Attempts made.
- Tests executed.
- Resource limitations.
- Unresolved issues.
- Recommended next actions.

Valid statuses:
VERIFIED, PARTIALLY_VERIFIED, BLOCKED, FAILED.

## 13. Implementation Boundaries
This document defines agent behavior. It does not itself enforce hard execution limits.

Where supported, implement deterministic enforcement through the execution environment, task runner, or CI controls.

Respect platform constraints and higher-priority instructions.

## Final Principle
Continue only when an action is justified, safe, and potentially informative.

Stop when further execution is repetitive, unsafe, unauthorized, or no longer productive.

Maximize verified progress, not the number of attempts.
