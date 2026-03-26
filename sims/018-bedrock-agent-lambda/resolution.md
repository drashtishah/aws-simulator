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

Update the Lambda resource-based policy to use the correct agent ARN:

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

1. Add a CloudWatch alarm on `AWS/Lambda` `Invocations` metric for the `clairvue-dashboard-query` function. Trigger when the sum drops to zero for one hour during business hours.
2. Add a CloudWatch alarm on Bedrock agent action group invocation metrics to detect when action groups stop being called.
3. Add integration tests to the CI pipeline that invoke the Bedrock Agent after policy changes and verify the action group is actually called (check for `actionGroupInvocationOutput` in the trace).
4. Document the distinction between agent execution role ARNs and agent ARNs in the team's infrastructure runbook.

## Key Concepts

### Bedrock Agent Resource-Based Policies

Amazon Bedrock Agents invoke Lambda functions as part of action groups. The Lambda function must have a resource-based policy that allows the `bedrock.amazonaws.com` service principal to invoke it. The `aws:SourceArn` condition must reference the **agent ARN** (format: `arn:aws:bedrock:<region>:<account>:agent/<agent-id>`), not the agent's IAM execution role ARN. The execution role is what the agent assumes to call AWS services on its behalf. The agent ARN identifies the agent as a Bedrock resource. These are different identifiers serving different purposes.

### Lambda Invoke Permissions

Lambda resource-based policies are evaluated before a function is invoked. If the calling service does not match the policy conditions, the invocation is rejected. Unlike IAM role-based access, where denials often produce explicit `AccessDenied` errors, resource-based policy rejections from service integrations can be silent. The calling service receives a failure but may handle it internally without surfacing an error to the end user.

### Silent Fallback Behavior

Bedrock Agents are designed to be resilient. When an action group invocation fails, the agent does not return an error to the user. Instead, it attempts to generate a response using the foundation model and any available context. This is useful for graceful degradation but dangerous when the action group is the primary source of truth. The agent will produce confident, well-structured responses that contain no real data. There is no visual indicator in the agent's response that the action group was skipped.

## AWS Documentation Links

- [[https://docs.aws.amazon.com/bedrock/latest/userguide/agents-permissions.html|Bedrock Agents Permissions]]
- [[https://docs.aws.amazon.com/bedrock/latest/userguide/agents-action-create.html|Create Action Groups for Bedrock Agents]]
- [[https://docs.aws.amazon.com/lambda/latest/dg/access-control-resource-based.html|Lambda Resource-Based Policies]]
- [[https://docs.aws.amazon.com/bedrock/latest/userguide/agents-trace.html|Trace and Debug Bedrock Agents]]

## Learning Objectives

- Understand the difference between IAM execution role ARNs and Bedrock agent ARNs when configuring resource-based policies
- Know how Lambda resource-based policies control which services can invoke a function
- Recognize Bedrock Agents silent fallback behavior when action groups fail to execute
- Appreciate the importance of monitoring action group invocation metrics to detect silent failures early
