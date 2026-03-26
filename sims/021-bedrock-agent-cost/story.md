---
tags:
  - type/simulation
  - service/bedrock
  - service/cloudwatch
  - service/lambda
  - difficulty/associate
  - category/cost
---

# Ten Dollars a Minute

## Opening

The weekly cost report arrived on Monday morning. The line item for Amazon Bedrock read $12,147.83. The previous week it had been $812.40. The week before that, $803.15. Nobody had changed the pricing tier. Nobody had launched a marketing campaign. The number of user queries was the same as it had been for the past two months.

Camber Health builds patient portal software for healthcare providers. Eighty-five clinics and hospital networks use their platform. The core product is a patient-facing assistant that handles insurance eligibility checks, appointment scheduling, and benefits explanations. The assistant runs on Amazon Bedrock Agents, backed by Claude 3.5 Sonnet. It processes roughly 60,000 queries per week. The assistant has been running since January. The weekly Bedrock bill had never exceeded $850.

Eight days ago, a product engineer named Lian shipped a new action group called comprehensive-benefits. The feature allows the assistant to compare multiple insurance plan options side by side. A patient can ask "What does my HMO cover for physical therapy versus my PPO option?" and get a detailed comparison. The feature went through code review. It passed staging tests. Patients started using it immediately. The satisfaction scores for benefits-related queries went up by 34 percent.

The finance operations lead pulled the cost data at 8:47 AM on Monday. She opened the Cost Explorer, filtered by service, and stared at the graph. A flat line at $116 per day for weeks, then a vertical step to $1,714 per day starting on March 17th. She checked the Bedrock model invocation metrics. Token consumption per day had increased by a factor of ten. She checked the user query volume. Flat. She sent the numbers to the engineering channel and waited.

You are the platform engineer on call. The cost report is in front of you. Something changed eight days ago that made each query ten times more expensive.

## Resolution

The root cause was the comprehensive-benefits action group. When a user asked a benefits comparison question, the Bedrock Agent entered a multi-step reasoning loop. Instead of making a single call to retrieve and compare plan data, the agent invoked the action group six to eight times per query. Each invocation triggered a full reasoning cycle: the agent generated chain-of-thought tokens to decide what to do next, called the action group, processed the result, and then reasoned again about the next step.

A single benefits comparison query generated approximately 27,800 reasoning tokens, 2,000 input tokens, and 800 output tokens. The reasoning tokens -- the internal chain-of-thought that the user never sees -- were billed at the standard output token rate. A query that previously cost $0.02 now cost $0.20. Across 60,000 queries per week, with roughly 40 percent hitting the new action group, the weekly cost jumped from $812 to $12,147.

The fix had two parts. First, the action group was refactored to return consolidated plan comparison data in a single invocation rather than requiring the agent to make multiple calls for individual plan details, copay information, and network data separately. This reduced the reasoning steps from six to eight down to two. Second, the team configured CloudWatch alarms on the `InvocationTokenCount` metric for the Bedrock agent, with thresholds at 5,000 tokens per invocation and $500 per day in estimated cost. A budget alert was added in AWS Budgets for the Bedrock service at 120 percent of the $3,500 monthly allocation.

The refactored action group reduced per-query cost to $0.035. Weekly Bedrock cost dropped to $1,260. The overspend for the eight-day period was $11,335.43 above baseline.
