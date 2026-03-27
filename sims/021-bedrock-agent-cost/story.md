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

company: Camber Health
industry: healthcare SaaS, Series B startup, 52 engineers
product: patient portal software for healthcare providers -- insurance eligibility checks, appointment scheduling, benefits explanations
scale: 85 clinics and hospital networks, 60,000 queries per week
model: Amazon Bedrock Agents backed by Claude 3.5 Sonnet, running since January
time: 8:47 AM, Monday morning
scene: weekly cost report arrives
alert: Bedrock line item reads $12,147.83 -- previous week was $812.40, week before that $803.15
stakes: weekly Bedrock bill had never exceeded $850, no pricing tier change, no marketing campaign, user query volume flat for two months
early_signals:
  - finance operations lead opened Cost Explorer, filtered by service: flat line at $116/day for weeks, then vertical step to $1,714/day starting March 17th
  - Bedrock model invocation metrics show token consumption per day increased 10x
  - user query volume is flat
  - finance lead sent numbers to engineering channel
recent_change: eight days ago, product engineer Lian shipped new action group called comprehensive-benefits -- allows assistant to compare multiple insurance plan options side by side (e.g., "What does my HMO cover for physical therapy versus my PPO option?"), went through code review, passed staging tests, patient satisfaction scores for benefits-related queries up 34%
investigation_starting_point: you are the platform engineer on call, cost report is in front of you, something changed eight days ago that made each query ten times more expensive

## Resolution

root_cause: the comprehensive-benefits action group caused the Bedrock Agent to enter a multi-step reasoning loop -- instead of a single call to retrieve and compare plan data, the agent invoked the action group 6-8 times per query, each invocation triggering a full reasoning cycle (chain-of-thought tokens to decide next step, action group call, result processing, then reasoning again)
mechanism: a single benefits comparison query generated approximately 27,800 reasoning tokens, 2,000 input tokens, and 800 output tokens. Reasoning tokens (internal chain-of-thought the user never sees) billed at standard output token rate. Per-query cost went from $0.02 to $0.20. Across 60,000 queries/week with ~40% hitting the new action group, weekly cost jumped from $812 to $12,147.
fix: two parts -- (1) refactored action group to return consolidated plan comparison data in a single invocation instead of requiring multiple calls for individual plan details, copay information, and network data separately, reducing reasoning steps from 6-8 down to 2; (2) configured CloudWatch alarms on InvocationTokenCount metric with thresholds at 5,000 tokens per invocation and $500/day estimated cost, added AWS Budgets alert for Bedrock service at 120% of $3,500 monthly allocation
outcome: refactored action group reduced per-query cost to $0.035, weekly Bedrock cost dropped to $1,260, overspend for eight-day period was $11,335.43 above baseline
