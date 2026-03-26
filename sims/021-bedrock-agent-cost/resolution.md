---
tags:
  - type/resolution
  - service/bedrock
  - service/cloudwatch
  - service/lambda
  - difficulty/associate
  - category/cost
---

# Resolution: Ten Dollars a Minute

## Root Cause

The Bedrock Agent `camber-support-agent` (agent ID `AGNT7X2K9M`) uses three action groups: `eligibility-check`, `appointment-schedule`, and `comprehensive-benefits`. The `comprehensive-benefits` action group was deployed on 2026-03-17. When invoked, the agent enters a multi-step orchestration loop, calling the action group six to eight times per user query to retrieve individual plan details, copay structures, network information, and comparison summaries separately.

Each action group invocation triggers a full reasoning cycle. The agent generates approximately 4,000 chain-of-thought tokens per step to decide its next action. These internal reasoning tokens are billed at the standard output token rate ($0.003 per 1K tokens for Claude 3.5 Sonnet). A single benefits comparison query generates ~27,800 reasoning tokens, ~2,000 input tokens, and ~800 output tokens. Per-query cost increased from $0.02 to $0.20. With ~60,000 queries per week (approximately 40% hitting the new action group), weekly Bedrock cost rose from $812 to $12,147.

No CloudWatch alarms were configured on Bedrock token consumption metrics. No AWS Budget alerts existed for the Bedrock service. The cost increase ran for eight days before the weekly cost report surfaced it.

## Timeline

| Time | Event |
|---|---|
| 2026-03-17 09:14 UTC | Product engineer deploys `comprehensive-benefits` action group to production Bedrock Agent. |
| 2026-03-17 09:22 UTC | First user query hits the new action group. Agent trace shows 7 orchestration steps, 28,400 total tokens. |
| 2026-03-17 23:59 UTC | Daily Bedrock cost: $1,714.22 (baseline: $116.06). No alerts fire -- none configured. |
| 2026-03-18 - 2026-03-23 | Daily costs remain at $1,680-$1,740. Lambda invocation count jumps from ~8,500/day to ~52,000/day. No one reviews the metrics. |
| 2026-03-24 08:00 UTC | Weekly cost report generated. Bedrock line item: $12,147.83. Previous week: $812.40. |
| 2026-03-25 08:47 UTC | Finance operations lead opens Cost Explorer. Identifies step-function increase on March 17th. Posts to engineering channel. |
| 2026-03-25 09:30 UTC | Platform engineer reviews Bedrock agent traces. Identifies multi-step reasoning loop in comprehensive-benefits queries. |
| 2026-03-25 11:15 UTC | Action group refactored to return consolidated comparison data in single invocation. Deployed to staging. |
| 2026-03-25 13:00 UTC | Refactored action group deployed to production. Per-query token count drops from ~30,600 to ~5,200. |
| 2026-03-25 14:00 UTC | CloudWatch alarms configured on Bedrock token metrics. AWS Budget alert set at $3,500/month for Bedrock. |

## Correct Remediation

### Immediate Fix

Refactor the `comprehensive-benefits` action group to consolidate data retrieval. Instead of exposing granular API actions that force the agent to reason through multiple sub-steps (get plan A details, get plan B details, compare copays, compare networks), provide a single `compare-plans` action that accepts both plan IDs and returns a pre-structured comparison object. This reduces agent orchestration steps from 6-8 down to 2 (one call to retrieve data, one to format the response).

### Monitoring

1. **CloudWatch Alarm on token consumption**: Create an alarm on the `AWS/Bedrock` namespace metric `InvocationTokenCount` with a threshold of 5,000 tokens per invocation. Any single agent invocation exceeding this threshold triggers a notification.
2. **Daily cost alarm**: Use a CloudWatch metric math expression on the `InvocationTokenCount` metric, multiplied by the per-token rate, to estimate daily cost. Alarm at $200/day (roughly 1.7x the baseline daily cost).
3. **AWS Budgets**: Set a monthly budget of $3,500 for the Bedrock service with alerts at 80% ($2,800) and 100% ($3,500).
4. **Agent trace sampling**: Enable model invocation logging to S3 and set up a periodic review of agent traces to catch reasoning loop regressions.

### Architecture Improvement

Design action groups with the agent's reasoning pattern in mind. Each action group invocation costs reasoning tokens in both directions -- the agent reasons about what to call, then reasons about the result. Fewer, richer action group responses reduce the total reasoning overhead. Consider setting `maximumIterations` on the agent's orchestration configuration to cap the number of reasoning steps per query.

## Key Concepts

### Bedrock Agent Token Billing

Amazon Bedrock Agents use a foundation model to orchestrate multi-step workflows. The agent generates chain-of-thought reasoning tokens at each step to decide which action to take next. These reasoning tokens are internal -- the end user never sees them -- but they are billed at the standard output token rate for the underlying model. In multi-step workflows, reasoning tokens can exceed the visible input and output tokens by an order of magnitude.

### Chain-of-Thought Cost Multiplier

Each orchestration step in a Bedrock Agent generates roughly 3,000-5,000 reasoning tokens depending on the complexity of the action group schema and the context accumulated from prior steps. An agent that makes N action group calls per query generates approximately N * 4,000 reasoning tokens on top of the actual input and output tokens. This creates a cost multiplier that scales linearly with the number of orchestration steps.

### Cost Monitoring for Generative AI Workloads

Standard AWS cost monitoring (monthly bills, Cost Explorer) has a lag that makes it unsuitable as the sole monitoring mechanism for generative AI workloads where per-request cost can change dramatically with prompt or agent configuration changes. Real-time monitoring requires CloudWatch metrics on token consumption, combined with budget alerts at daily and monthly granularity.

## Other Ways This Could Break

### Prompt Template Inflation After Instruction Update

Instead of action group loops causing excess tokens, an update to the agent's system instructions or prompt template adds verbose context that inflates every query's input token count. The cost increase is uniform across all queries rather than concentrated on comparison queries. The agent trace shows fewer orchestration steps but higher input tokens per step.

**Prevention:** Track prompt template token counts as a deployment metric. Set a CloudWatch alarm on average InputTokenCount per invocation to catch instruction bloat early.

### Knowledge Base Over-Retrieval Expanding Context Window

A knowledge base associated with the agent returns too many document chunks per query, inflating the context window. The cost increase comes from input tokens (retrieved context) rather than output/reasoning tokens. The agent trace shows normal orchestration step counts but abnormally large input payloads at the orchestration step that queries the knowledge base.

**Prevention:** Set Top K limits on knowledge base retrieval. Use metadata filters to scope retrieval to relevant document categories. Monitor InputTokenCount at the knowledge base query step.

### Model Upgrade Silently Increases Per-Token Pricing

The foundation model is updated to a newer, more expensive version (for example, moving from Claude 3 Haiku to Claude 3.5 Sonnet) without updating cost projections. Token counts remain the same, but the per-token rate increases. Cost Explorer shows a step increase that correlates with the model change rather than an action group deployment.

**Prevention:** Pin agent foundation model versions explicitly. Review Bedrock pricing when changing models. Include per-token cost estimates in deployment checklists.

## SOP Best Practices

- Design Bedrock Agent action groups to return consolidated, rich responses rather than granular data that forces multi-step reasoning loops.
- Set CloudWatch alarms on Bedrock token consumption metrics (InputTokenCount, OutputTokenCount) at the per-invocation and daily aggregate level before deploying new agent features.
- Configure AWS Budgets alerts for Bedrock at both 80% and 100% of your monthly allocation, with daily anomaly detection enabled.
- Enable model invocation logging to S3 and periodically sample agent traces to catch reasoning loop regressions before they appear in monthly bills.

## Learning Objectives

- **Bedrock Agent token billing**: Understand that internal reasoning tokens in multi-step agent workflows are billed at standard output rates, and can represent the majority of token consumption for complex queries.
- **Cost multiplier in agentic architectures**: Recognize that each additional orchestration step adds thousands of reasoning tokens. Action group design directly determines per-query cost.
- **Monitoring for GenAI workloads**: Set up token-level CloudWatch alarms and daily cost thresholds rather than relying solely on monthly billing cycles.
- **Action group design**: Build action groups that return rich, consolidated responses to minimize the number of reasoning steps the agent must perform.
