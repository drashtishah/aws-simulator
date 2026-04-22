---
tags:
  - type/resolution
  - service/bedrock-agentcore
  - service/bedrock
  - service/cloudwatch
  - service/iam
  - difficulty/professional
  - category/cost
---

# Resolution: The Agent That Would Not Stop

## Root Cause

The `lanternfish-research-agent` runtime on Amazon Bedrock AgentCore had dozens of sessions running continuously, long after the users who started them had closed their browser tabs. The agent loop would not exit because a stop hook (a small piece of code that decides whether the agent has finished) was crashing on certain tool outputs. The agent framework caught the crash, wrote the Python traceback back onto the agent's scratchpad (the short-term memory the agent reads on every turn), and the agent reasoned over the traceback as if it were a new user message.

Because the agent kept producing output on every turn, AgentCore never considered the session idle. The default safety setting that kills idle sessions after 15 minutes (called `idleRuntimeSessionTimeout`, 900 seconds by default) never triggered. Sessions therefore ran until the absolute maximum lifetime setting (`maxLifetime`, default 8 hours), and then fresh ones replaced them. Total damage over nine hours: about 3.1 billion Bedrock tokens and roughly fourteen hundred dollars before the bill alarm fired.

## Timeline

| Time (UTC) | Event |
|---|---|
| Day -14, 15:40 | Stop hook merged. Decodes tool output with `.decode()`, no `errors='replace'`. |
| Day 0, 01:12 | A research tool scrapes a page whose raw bytes contain `0xF4`. Stop hook raises `UnicodeDecodeError`. |
| Day 0, 01:12 | Agent framework writes the traceback onto the scratchpad as a tool-result message. Agent treats it as input and keeps reasoning. |
| Day 0, 01:13 to Day 0, 10:00 | Ninety-two sessions enter the same loop over the next two hours as more users hit the bad scrape. Sessions run at roughly four turns per minute, ~6,200 tokens per turn. |
| Day 0, 10:02 | `BillingAlarm-bedrock-daily` fires at the $1,500 threshold. On-call is paged. |
| Day 0, 10:24 | Patched container image deployed via `UpdateAgentRuntime`. New sessions get the fixed hook. Existing microVMs keep running. |
| Day 0, 10:26 | `maxLifetime` lowered from 28800 to 600 seconds to force the stuck sessions to drain. |
| Day 0, 10:36 | Last long-lived session terminates. Token count drops to baseline. |

## Correct Remediation

1. **Confirm the shape of the bill first.** Open the CloudWatch metric `AWS/Bedrock InputTokenCount` for the model the agent uses. A flat, sustained ceiling across hours points to sessions that are running on their own. A single sharp spike points to one bad prompt or one bad user. They are different problems with different fixes.
2. **Count active sessions from logs, not from an API.** AgentCore does not expose `ListSessions`. Go to the `/aws/bedrock-agentcore/<runtime-name>` CloudWatch log group and filter the last five minutes for unique `runtimeSessionId` values. Compare that number to how many users are currently in the app. A big gap is the smoking gun.
3. **Read one bad session's last forty turns.** Pull the log events for one `runtimeSessionId` and read the agent's messages in order. If the agent is reasoning about its own errors, tracebacks, or system messages instead of a human's question, you are looking at a self-feeding loop.
4. **Deploy a fix that stops new sessions from entering the loop.** Patch the container, bump the image tag, and call `UpdateAgentRuntime`. Expect existing sessions to keep running; `UpdateAgentRuntime` does not force-terminate active microVMs. This is a deliberate AgentCore design choice so that in-flight user conversations are not dropped mid-turn.
5. **Drain the stuck sessions with a short `maxLifetime`.** Call `UpdateAgentRuntime` again with a new `LifecycleConfiguration` whose `maxLifetime` is low (for example, 600 seconds). AgentCore terminates each active session as it crosses the new cap. Restore the normal value once the log group is quiet.
6. **Add a session registry as a permanent guardrail.** AgentCore does not list sessions, so keep your own list. Write every `runtimeSessionId` to a small DynamoDB table with `createdAt` and `lastTurnAt`. A scheduled Lambda can flag any row older than your business cap (30 minutes is a reasonable default for a research assistant) and ask the chat router to send a graceful stop message.
7. **Alarm on cost before it becomes a crisis.** Add a CloudWatch alarm on `AWS/Bedrock InputTokenCount` summed across the agent's model for a 15-minute period, tuned to two or three times your normal peak. Page on-call when it breaches.

## Key Concepts

### Why AgentCore's idle timeout cannot save you from a runaway agent

AgentCore Runtime considers a session idle when the microVM (the small dedicated virtual machine the session runs in) stops emitting new output. The default is 900 seconds (15 minutes) of silence. This works well when the agent has given a final answer and the user has closed the tab: AgentCore waits 15 minutes, then shuts the microVM down and stops billing you. It does not work when the agent is reasoning about its own previous output, because from AgentCore's perspective the session is working. There is no way for the managed service to know whether the "user" behind the conversation is a real person or an echoed traceback. You have to build that check yourself: cap the number of agent turns inside your own code, time-box each session from your own registry, or watch for patterns on the scratchpad that look like self-feedback.

### Why `UpdateAgentRuntime` does not kill in-flight sessions

AgentCore is designed for long-running conversations, some of which legitimately take hours. A deploy that interrupts an in-progress conversation would drop user work. So `UpdateAgentRuntime` only changes the settings and container image for new sessions. Existing sessions see the new configuration when they naturally end. During an incident this means you cannot "roll back" your way out: deploying a fix stops the bleeding for new users but you still need a drain mechanism. The most reliable drain is to temporarily lower `maxLifetime` because that is the one setting that forcibly terminates a session regardless of whether it is idle.

### Building a session registry

Because AgentCore has no `ListSessions` or `ForceEndSession` API, a thin session registry in DynamoDB is the missing primitive. Every time your app creates a new `runtimeSessionId`, write a row with the ID, the user, `createdAt`, and `lastTurnAt`. On every turn, update `lastTurnAt`. An EventBridge-scheduled Lambda scans the table and, for rows older than your cap, calls your chat router with a special end-of-session message. The chat router sends one last well-formed user turn to AgentCore asking the agent to wrap up, which lets the agent reach an idle state and exit cleanly. This pattern also gives you the answer to "how many sessions are active right now" without scraping logs.

## Other Ways This Could Break

### The stop hook is fine, but a tool handler keeps retrying its own error forever
The stop hook works. But a tool (say, a web search or a database query) returns its own error message on failure, and the agent treats the error as a transient issue worth retrying. Each turn the agent tries the same tool, gets the same error, and tries again. The session stays busy, idle timeout never fires, and costs climb the same way they did in this sim.
**Prevention:** Cap tool retries at a small number (three is a good default) in the agent framework configuration. After the cap, return a terminal error payload that clearly tells the agent to stop and summarize the failure to the user. Log the retry count as a CloudWatch metric and alarm when it gets unusually high.

### Users close their browser tabs, but sessions linger because nothing sends an explicit end
The agent itself is not runaway. What keeps the compute running is that the web app never tells AgentCore a user has left. Every session waits out the full 15-minute idle timeout before AgentCore kills it. With a few thousand users per day, that idle time adds up to a large compute bill even though no single session looks abnormal.
**Prevention:** Send a page-unload beacon from the web app to an endpoint that calls a graceful end-turn on AgentCore. Lower `idleRuntimeSessionTimeout` to 120 seconds for short-form assistants that rarely have long pauses. Split long-running analytics traffic into its own AgentCore Runtime with a longer timeout so you can tune short-form traffic aggressively.

### The agent's execution role grants access to every Bedrock model, and the agent uses the most expensive one
Session count looks normal and the loop is fine, but per-turn costs are three to four times higher than expected. Somebody changed the model ID in a config file, or the agent framework defaulted to a premium model when the configured one was unavailable. The bill rises not because of volume but because each token is more expensive.
**Prevention:** Scope the IAM execution role to only the model ARNs the agent is allowed to use. Pin the model ID inside the container and refuse to start the agent if the configured model is not on the allowlist. Add a CloudWatch alarm on per-model input token spend so a model swap shows up as an anomaly.

## SOP Best Practices

- Design every agent for explicit termination. The agent loop should have a clear exit condition (final answer delivered, plan finished, or max-turns reached) and the stop hook should never be the only safety net. Assume AgentCore's idle timeout will not fire and enforce a hard turn cap inside your own code.
- Keep a session registry outside AgentCore. Because AgentCore does not list or force-terminate sessions, your DynamoDB-backed list is the missing piece. It lets you answer basic operational questions ("how many sessions are active right now?") without trawling logs.
- Treat `LifecycleConfiguration` as a safety cap, not a correctness mechanism. Set `maxLifetime` and `idleRuntimeSessionTimeout` to the shortest values that work for your use case. Eight hours at agent pricing is enough to hurt.
- Guard the scratchpad. Never write raw stderr, raw exception output, or untrusted strings back onto the agent's context. The scratchpad is an input to the model and the model cannot tell the difference between an intentional instruction and an echoed traceback.

## Learning Objectives

1. **AgentCore session economics**: Understand how sessions are billed, how `idleRuntimeSessionTimeout` and `maxLifetime` bound the bill, and why neither can save you from an agent that never stops emitting output.
2. **Incident containment without a kill switch**: Learn how to drain a pool of stuck AgentCore sessions using a short `maxLifetime` when no `ForceEndSession` API exists.
3. **Session registry pattern**: Build a DynamoDB-backed list of active sessions that turns "how many sessions are running?" into a cheap query.
4. **Stop-hook hardening**: Treat everything written back to the agent scratchpad as untrusted input and sanitize accordingly.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 4: Cost Control
- [[learning/catalog.csv]] -- Player service catalog and progress
