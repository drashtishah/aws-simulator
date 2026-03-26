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

The assistant had been answering questions all weekend. Every response was polite, structured, confident. None of them were correct.

Clairvue Analytics runs a business intelligence platform for mid-market companies. Three hundred and forty accounts. Two point eight million in annual recurring revenue. Their product includes an AI assistant built on Amazon Bedrock Agents that queries customer dashboards through a Lambda-backed action group. Customers ask plain-language questions about their metrics. The agent calls the Lambda function, which hits the internal dashboard API, and returns real numbers. That is the product.

On Friday afternoon at four o'clock UTC, a platform engineer deployed an updated resource-based policy for the Lambda function. The deployment succeeded. The CI pipeline reported green across all checks. The engineer closed the pull request and went home. The assistant continued to receive queries through the weekend. It responded to every one of them.

Monday morning, the first ticket arrived at eight-fourteen from a logistics company on the enterprise tier. Their Q1 revenue figures from the assistant did not match the numbers on their dashboard. The second ticket came at eight-twenty-one. By nine o'clock, seven enterprise accounts had reported the same thing. The assistant was producing metrics that looked reasonable. They were formatted correctly, presented with appropriate caveats, and entirely fabricated. The Bedrock Agent was not calling the action group at all. It was generating answers from the foundation model alone, drawing on training data and pattern matching instead of querying real dashboards.

## Resolution

The root cause was in the Lambda function's resource-based policy. When the platform engineer updated the policy on Friday, they set the `aws:SourceArn` condition to the Bedrock agent's IAM execution role ARN: `arn:aws:iam::847291034651:role/AmazonBedrockExecutionRoleForAgents_clairvue`. The correct value was the agent ARN itself: `arn:aws:bedrock:us-east-1:847291034651:agent/ABCDE12345`. These are different resources. The IAM role is what the agent assumes to perform actions. The agent ARN identifies the agent as a Bedrock resource. Lambda's resource-based policy expects the latter when validating invocations from the Bedrock Agents service.

With the wrong ARN in the condition, Lambda silently rejected every invocation attempt from the Bedrock Agent. No error was returned to the caller. No CloudWatch error metric was emitted. The Bedrock Agent, receiving no response from the action group, fell back to its default behavior: generating an answer using the foundation model without external data. This is by design. Bedrock Agents treat action group failures as non-fatal and attempt to satisfy the user's query with available context. The result was a weekend of confident, well-formatted, hallucinated responses.

The fix was a single policy update. The `aws:SourceArn` condition was changed to the correct agent ARN. The Lambda function began receiving invocations immediately. The team also added a CloudWatch alarm on the Lambda function's invocation count, configured to trigger when the metric dropped to zero for more than one hour during business days. A second alarm was placed on the Bedrock agent's action group invocation metrics. These would have caught the problem within an hour of the Friday deploy, instead of allowing it to run undetected for sixty-three hours.
