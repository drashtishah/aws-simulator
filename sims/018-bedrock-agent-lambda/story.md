---
tags:
  - type/simulation
  - service/bedrock
  - service/lambda
  - service/iam
  - service/cloudwatch
  - difficulty/associate
  - category/operations
---

# The Agent That Could Not Act

## Opening

company: Clairvue Analytics
industry: business intelligence platform for mid-market companies, Series A startup, 22 engineers
product: AI assistant built on Amazon Bedrock Agents that queries customer dashboards through a Lambda-backed action group, returns real metrics in plain language
scale: 340 accounts, $2.8M annual recurring revenue
time: Monday morning, 8:14 AM (problem began Friday 4:00 PM UTC)
scene: enterprise customers discovering assistant has been returning fabricated metrics all weekend
alert: enterprise tier customer reports Q1 revenue figures from assistant do not match dashboard numbers
stakes: assistant responded to every query over the weekend with confident, well-formatted, entirely fabricated answers; customers making business decisions on hallucinated data
early_signals:
  - Friday 4:00 PM UTC, platform engineer deployed updated resource-based policy for Lambda function; CI pipeline green, PR closed
  - assistant continued receiving and responding to queries all weekend with no errors
  - Monday 8:14 AM, first ticket from logistics company on enterprise tier -- Q1 revenue figures do not match dashboard
  - 8:21 AM, second ticket; by 9:00 AM, seven enterprise accounts reporting same issue
  - metrics from assistant look reasonable, formatted correctly, presented with appropriate caveats, but entirely fabricated
investigation_starting_point: the Bedrock Agent is not calling the action group at all. It is generating answers from the foundation model alone, drawing on training data and pattern matching instead of querying real dashboards.

## Resolution

root_cause: platform engineer updated Lambda function resource-based policy on Friday, set aws:SourceArn condition to Bedrock agent IAM execution role ARN (arn:aws:iam::847291034651:role/AmazonBedrockExecutionRoleForAgents_clairvue) instead of the agent ARN itself (arn:aws:bedrock:us-east-1:847291034651:agent/ABCDE12345). IAM role is what the agent assumes to perform actions; agent ARN identifies the agent as a Bedrock resource. Lambda resource-based policy expects the agent ARN when validating invocations from the Bedrock Agents service.
mechanism: Lambda silently rejected every invocation attempt from the Bedrock Agent -- no error returned to caller, no CloudWatch error metric emitted. Bedrock Agent, receiving no response from action group, fell back to default behavior: generating answers using foundation model without external data. Bedrock Agents treat action group failures as non-fatal by design. Result was 63 hours of confident, well-formatted, hallucinated responses.
fix: update aws:SourceArn condition to correct agent ARN (arn:aws:bedrock:us-east-1:847291034651:agent/ABCDE12345). Lambda function began receiving invocations immediately.
contributing_factors:
  - no CloudWatch alarm on Lambda invocation count (would have triggered when metric dropped to zero for more than 1 hour during business days)
  - no alarm on Bedrock agent action group invocation metrics
  - CI pipeline validated policy deployment success but not end-to-end invocation
  - silent fallback behavior in Bedrock Agents made the failure invisible to users and operators alike
