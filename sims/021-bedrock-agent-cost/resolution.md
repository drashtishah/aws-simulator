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

The core problem is that the agent's tool (called an action group) is split into too many small endpoints, forcing the agent to call them one at a time and think between each call. The fix: combine those small endpoints into one. Instead of separate calls for plan A details, plan B details, copay comparison, and network comparison, create a single `compare-plans` endpoint that accepts both plan IDs and returns everything at once. This cuts the agent's thinking steps from 6-8 down to 2 (one call to fetch data, one to format the answer). Fewer steps means fewer internal thinking tokens, which means a lower bill.

### Monitoring

1. **CloudWatch Alarm on token consumption**: A CloudWatch alarm is an automated rule that watches a metric and notifies you when it crosses a limit. Create one on the `AWS/Bedrock` namespace metric `InvocationTokenCount` (which tracks how many tokens each model call uses) with a threshold of 5,000 tokens. If any single call exceeds that, you get notified right away instead of finding out a week later.
2. **Daily cost alarm**: Use a CloudWatch metric math expression -- a formula that combines metrics -- to multiply `InvocationTokenCount` by the per-token price, giving you an estimated daily cost metric. Set an alarm at $200/day (roughly 1.7x the normal daily cost) so a sudden jump triggers an alert.
3. **AWS Budgets**: AWS Budgets is a service that tracks your spending and warns you before you blow past a limit. Set a monthly budget of $3,500 for Bedrock with alerts at 80% ($2,800) and 100% ($3,500).
4. **Agent trace sampling**: Turn on model invocation logging, which saves a detailed record of every model call to S3 (AWS's file storage). Periodically review these agent traces -- the step-by-step logs of the agent's thinking -- to catch cases where the agent starts looping through too many steps before the extra costs show up on your bill.

### Architecture Improvement

When designing tools for a Bedrock Agent, remember that every time the agent calls a tool, it spends tokens thinking about what to call and then thinking about the result. Those internal thinking tokens (called chain-of-thought or reasoning tokens) are invisible to users but show up on your bill. Fewer, richer tool responses mean less thinking overhead. You can also set a hard cap on how many thinking steps the agent is allowed per query using the `maximumIterations` setting in the agent's orchestration configuration.

## Key Concepts

### Bedrock Agent Token Billing

A Bedrock Agent is an AI assistant that can call external tools to answer questions. To decide which tool to call next, the agent "thinks" internally -- generating text that the user never sees. These invisible thinking steps are called chain-of-thought reasoning tokens. The important thing to know: you pay for these hidden thinking tokens at the same rate as the visible response text. The AI model processes text in small chunks called tokens (roughly one token per word), and AWS charges you for every token the model reads or writes -- including the private thinking. In workflows where the agent calls several tools in sequence, these reasoning tokens can far exceed the text the user actually sees, sometimes by 10x or more.

### Chain-of-Thought Cost Multiplier

Every time the agent calls a tool, it goes through a full thinking cycle: it reasons about what to do, calls the tool, reads the result, then reasons about what to do next. Each cycle generates roughly 3,000-5,000 reasoning tokens. So if the agent calls tools N times per query, it generates about N times 4,000 extra tokens on top of the user-visible input and output. This means the cost of a query scales directly with the number of tool calls. An agent that calls tools 7 times costs roughly 7x more in thinking tokens than one that calls a tool once.

### Cost Monitoring for Generative AI Workloads

The usual AWS spending tools -- monthly bills and Cost Explorer (the spending dashboard) -- update with a delay, sometimes up to 24 hours. That lag is dangerous for AI workloads because a single configuration change can multiply your per-request cost overnight. By the time the monthly report catches it, you may have burned through your entire budget. To catch spikes fast, you need real-time monitoring: CloudWatch alarms (automated rules that watch metrics and page you when something crosses a threshold) on token consumption, combined with AWS Budgets alerts (spending cap warnings) at both daily and monthly levels.

## Other Ways This Could Break

### Prompt Template Inflation After Instruction Update

Instead of the agent looping through too many tool calls, someone edits the system instructions -- the behind-the-scenes directions that tell the agent how to behave. The new instructions are much longer, so every query sends more text to the model. Since you pay per token (per chunk of text the model reads), the cost goes up evenly across all queries, not just comparison queries. The agent trace (the step-by-step thinking log) shows fewer thinking steps but more text fed into the model at each step.

**Prevention:** Track how many tokens your system instructions use and check that number before each deployment. Set up a CloudWatch alarm (an automated alert rule) on the average InputTokenCount per call to catch instruction bloat early.

### Knowledge Base Over-Retrieval Expanding Context Window

A knowledge base is a document store the agent can search for answers. If it pulls back too many document chunks per query, it stuffs the context window -- the block of text the model reads before responding -- with unnecessary material. The extra cost comes from input tokens (the retrieved documents) rather than reasoning tokens (the agent's private thinking). The agent trace shows a normal number of steps, but the step where it queries the knowledge base has an unusually large input payload.

**Prevention:** Limit how many document chunks the knowledge base returns per query using the Top K setting. Use metadata filters to narrow searches to relevant document categories. Monitor the InputTokenCount metric at the knowledge base query step.

### Model Upgrade Silently Increases Per-Token Pricing

Someone switches the AI model to a newer, more capable version (for example, from Claude 3 Haiku to Claude 3.5 Sonnet) without realizing the new model costs more per token. The total number of tokens stays the same, but the price per token is higher. In Cost Explorer (the AWS spending dashboard), you see a cost jump that lines up with the model change, not with an action group deployment.

**Prevention:** Lock the agent to a specific model version so upgrades are deliberate. Review Bedrock pricing whenever you change models. Add per-token cost estimates to your deployment checklist so the team sees the dollar impact before approving a switch.

## SOP Best Practices

- When building tools for a Bedrock Agent (called action groups), design them to return complete answers in one call rather than small pieces that force the agent to call the tool repeatedly. Each extra call triggers a full cycle of internal thinking, and you pay for every thinking token even though users never see them.
- Before launching any new agent feature, set up CloudWatch alarms -- automated rules that watch a metric and notify you when it crosses a limit. Track Bedrock token consumption (InputTokenCount and OutputTokenCount) both per individual call and as a daily total, so you catch cost spikes the same day they start.
- Set up spending alerts using AWS Budgets, a service that warns you when your bill approaches a limit. Create alerts at 80% and 100% of your monthly Bedrock budget, and turn on daily anomaly detection so AWS automatically flags unusual spending patterns.
- Turn on model invocation logging, which saves a detailed record of every AI model call to S3 (AWS's file storage service). Periodically review agent traces -- the step-by-step logs of the agent's thinking -- to catch cases where the agent starts looping through too many steps before the extra costs appear on your monthly bill.

## Learning Objectives

- **Bedrock Agent token billing**: Understand that internal reasoning tokens in multi-step agent workflows are billed at standard output rates, and can represent the majority of token consumption for complex queries.
- **Cost multiplier in agentic architectures**: Recognize that each additional orchestration step adds thousands of reasoning tokens. Action group design directly determines per-query cost.
- **Monitoring for GenAI workloads**: Set up token-level CloudWatch alarms and daily cost thresholds rather than relying solely on monthly billing cycles.
- **Action group design**: Build action groups that return rich, consolidated responses to minimize the number of reasoning steps the agent must perform.
