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

# Resolution: The Agent That Could Not Act

## Root Cause

The Lambda function's resource-based policy contained an incorrect `aws:SourceArn` condition. The policy specified the Bedrock agent's IAM execution role ARN (`arn:aws:iam::847291034651:role/AmazonBedrockExecutionRoleForAgents_clairvue`) instead of the Bedrock agent ARN (`arn:aws:bedrock:us-east-1:847291034651:agent/ABCDE12345`).

When the Bedrock Agents service attempted to invoke the Lambda function, it presented the agent ARN as the source. Lambda evaluated this against the resource-based policy, found no matching condition, and rejected the invocation. The rejection was silent -- no error was surfaced to the Bedrock Agent or to CloudWatch. The Bedrock Agent then fell back to generating a response from the foundation model without action group data.

## Timeline

| Time (UTC) | Event |
|---|---|
| Fri 15:30 | Platform engineer opens PR to update Lambda resource-based policy |
| Fri 15:45 | PR approved, CI pipeline passes |
| Fri 16:00 | Policy deployed via infrastructure-as-code |
| Fri 16:00 | Lambda invocations from Bedrock Agent drop to zero |
| Fri 16:00 -- Mon 08:00 | Agent continues responding to queries using foundation model only |
| Mon 08:14 | First enterprise customer ticket: revenue figures do not match dashboard |
| Mon 09:00 | Seven enterprise accounts report incorrect metrics |
| Mon 09:30 | Engineering lead confirms zero Lambda invocations since Friday |

## Correct Remediation

### Immediate Fix

The Lambda function's resource-based policy needs to say "allow the Bedrock Agent to call this function" -- and it must identify the agent correctly. A resource-based policy is a permission document attached directly to the function that controls who can invoke it. The key field is aws:SourceArn, which must contain the agent ARN (the unique identifier for the agent as a Bedrock resource), not the IAM execution role ARN (the role the agent uses internally to call AWS services). These look similar but identify different things.

Update the policy to use the correct agent ARN:

```json
{
  "Version": "2012-10-17",
  "Id": "default",
  "Statement": [
    {
      "Sid": "AllowBedrockAgentInvoke",
      "Effect": "Allow",
      "Principal": {
        "Service": "bedrock.amazonaws.com"
      },
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:us-east-1:847291034651:function:clairvue-dashboard-query",
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": "arn:aws:bedrock:us-east-1:847291034651:agent/ABCDE12345"
        }
      }
    }
  ]
}
```

### Preventive Measures

1. Set up a CloudWatch alarm on the Lambda Invocations metric for the clairvue-dashboard-query function. Have it alert when the invocation count drops to zero for one hour during business hours -- that means something stopped calling the function.
2. Set up a second alarm on Bedrock agent action group invocation metrics to detect when the agent stops using its tools. Monitoring both sides catches problems regardless of where they originate.
3. Add integration tests to the CI pipeline that invoke the Bedrock Agent after any policy change and verify the agent actually called the function. Look for actionGroupInvocationOutput in the agent trace -- if it is missing, the agent made up its answer.
4. Document the distinction between the agent ARN (identifies the agent as a Bedrock resource) and the execution role ARN (the IAM role the agent assumes) in the team's runbook. This is the exact confusion that caused this incident.

## Key Concepts

### Who is allowed to call this function -- resource-based policies for Bedrock Agents

When a Bedrock Agent needs to call a Lambda function (as part of an action group -- a set of tools the agent can use), the function must have a resource-based policy that grants permission. A resource-based policy is a JSON document attached directly to the function that says "these specific services and identities are allowed to invoke me." The critical detail is the aws:SourceArn condition, which must contain the agent ARN -- the unique identifier for the agent as a Bedrock resource, in the format arn:aws:bedrock:REGION:ACCOUNT:agent/AGENT-ID. Do not use the IAM execution role ARN (the role the agent assumes to call AWS services on its behalf). These two ARNs look similar but identify different things: one is the agent itself, the other is the role it uses.

### Why the rejection is silent -- Lambda invoke permissions

Lambda checks its resource-based policy before running a function. If the calling service does not match the policy conditions, Lambda rejects the call. But here is the tricky part: unlike IAM role denials (which often produce visible AccessDenied errors), resource-based policy rejections from service integrations can be completely silent. The calling service (Bedrock) receives a failure but may handle it internally without showing an error to the end user.

### The agent makes up answers instead of failing -- silent fallback behavior

Bedrock Agents are designed to keep working even when things go wrong. When an action group call fails (for any reason), the agent does not tell the user there was a problem. Instead, it generates an answer using only the AI model and whatever context it already has -- without fetching real data from your systems. This is called silent fallback. The response looks confident and well-structured, but it contains fabricated information. There is no visible indicator in the response that the action group was skipped. This makes monitoring essential -- without it, you will not know the agent stopped using real data.

## Other Ways This Could Break

### The function has no Bedrock permission entry at all

Instead of having the wrong ARN in the SourceArn field, the function's resource-based policy simply has no entry for bedrock.amazonaws.com. The effect is identical -- the agent silently falls back to fabricating answers -- but the fix is adding a new policy statement rather than correcting an existing one. To prevent this, include the Lambda resource-based policy in the same infrastructure-as-code template that creates the Bedrock Agent, and validate in CI that the policy exists before marking the deployment as complete.

### The action group is turned off or its API definition has errors

The Lambda function has correct permissions and would work if called, but the action group (the set of tools the agent can use) is either turned off (DISABLED state) or its API definition (an OpenAPI schema that describes what the tool does and what parameters it accepts) has validation errors. The agent cannot figure out what tool to call, so it skips the action group entirely. CloudWatch shows zero Lambda invocations -- the same symptom as this incident. After every agent update, verify the action group state is ENABLED. Include API schema validation in the CI pipeline.

### The Lambda function is called but crashes during execution

Bedrock successfully invokes the function (the resource-based policy is correct), but the function itself fails -- timeout, unhandled exception, or the downstream API it calls is down. The Lambda Invocations count is non-zero (the function is being called), but the Errors count is high. The agent may still fall back to fabricated answers, but at least CloudWatch error metrics give you a signal. Set the Lambda timeout high enough for downstream API latency and create alarms on both Invocations (alert when zero) and Errors (alert when elevated).

### The production alias points to an old version of the agent

Bedrock Agents support versioning -- you can edit a draft version while production traffic uses a stable alias. The draft may have the correct action group, but the production alias might still point to an older version that lacks the action group or references a different Lambda function. The resource-based policy is fine, but real traffic never reaches the updated agent. Always update the alias routing configuration after preparing a new agent version.

## SOP Best Practices

- When giving a Bedrock Agent permission to call a Lambda function, always use the agent ARN (arn:aws:bedrock:REGION:ACCOUNT:agent/AGENT-ID) in the SourceArn field. Do not use the IAM execution role ARN -- that identifies the role the agent uses internally, not the agent itself. Lambda checks the agent ARN when deciding whether to accept the call.
- Treat Lambda resource-based policy changes as high-risk. A passing CI pipeline does not mean the function is actually reachable. After any policy update, verify end-to-end by invoking the agent and confirming the trace shows real data from the function.
- Monitor both sides of every service connection. On the Lambda side, watch the Invocations metric to know whether the function is being called. On the Bedrock side, watch action group metrics to know whether the agent is using its tools. Either side can break independently.
- Add the aws:SourceAccount condition alongside SourceArn in Lambda resource-based policies. SourceAccount restricts which AWS account the caller must belong to. This prevents a confused deputy scenario -- where a service in a different account could trick Bedrock into calling your function on someone else's behalf.

## Learning Objectives

- Understand the difference between IAM execution role ARNs and Bedrock agent ARNs when configuring resource-based policies
- Know how Lambda resource-based policies control which services can invoke a function
- Recognize Bedrock Agents silent fallback behavior when action groups fail to execute
- Appreciate the importance of monitoring action group invocation metrics to detect silent failures early

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 1: Resource-Based Policies
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Lambda Permissions, Domain 2: IAM Policies
- [[catalog]] -- bedrock, lambda, iam, cloudwatch service entries
