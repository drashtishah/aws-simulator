---
tags:
  - type/simulation
  - service/bedrock-agentcore
  - service/bedrock
  - service/cloudwatch
  - service/iam
  - difficulty/professional
  - category/cost
---

# The Agent That Would Not Stop

## Opening

- company: Lanternfish
- industry: consumer AI research assistant
- product: a paid research assistant web app that plans multi-step web searches, reads results, and answers questions for students and early-career researchers
- scale: about 2,100 weekly active users on a seat plan, 9 engineers, one shared on-call rotation, AWS bill averaged four hundred dollars per day for the last month
- time: Tuesday 10:02 AM local
- scene: the founding engineer is the primary on-call. The CEO pings the engineering channel asking if there is a launch happening today. There is not.
- alert: "BillingAlarm-bedrock-daily: Bedrock estimated daily spend projected to exceed $8,000 (threshold $1,500)"
- stakes: the company's monthly Bedrock budget is thirty thousand dollars. Today alone is on pace to consume a third of it. The seed runway is tight and a weeks-long bill like this turns into a headcount conversation.
- early_signals:
  - No customer tickets. The app looks normal from the outside.
  - Token count on the research agent flat-lined at a ceiling overnight, when traffic is usually near zero
  - AgentCore Runtime shows healthy. InvokeAgentRuntime p50 latency is unchanged.
  - CloudWatch sessions metric was not wired up (AgentCore does not expose active session count directly)
- investigation_starting_point: the billing alarm points at Bedrock usage. The research agent runs on AgentCore. Nobody has deployed in 48 hours. Token usage should follow user traffic but clearly does not.

## Resolution

- root_cause: the lanternfish-research-agent AgentCore Runtime has dozens of active sessions that never become idle. Each session runs the agent in a loop that reads the previous turn's output, reasons, calls a tool, and reflects. A stop hook at the end of each turn decides whether to continue. The hook raises a UnicodeDecodeError on certain tool outputs. The agent framework catches the exception and writes the Python traceback onto the agent's scratchpad as a tool-result message. The agent reads the traceback, interprets it as new input, continues reasoning, and calls another tool. The loop is self-sustaining. Because the agent keeps emitting output on every turn, AgentCore's idleRuntimeSessionTimeout (default 900 seconds) never fires. Sessions run until maxLifetime (default 28800 seconds, 8 hours) and then a fresh one starts for the same user.
- mechanism: the stop hook was added two weeks ago by an engineer who wanted to short-circuit obvious answers. Its code calls .decode() on the tool output without specifying errors='replace'. For 499 out of 500 tool calls the output decodes cleanly. For the 500th, the tool returned a byte sequence from a scraped web page with a stray 0xF4 byte, and .decode() raised. The agent framework, running inside the AgentCore microVM, caught the exception, serialized the traceback with str(e) plus traceback.format_exc(), and appended the result to messages as {"role": "tool", "content": traceback_text}. On the next turn, the agent read the traceback, concluded it should retry the tool with a different query, and so on indefinitely. Each turn cost about 4,800 input tokens plus 1,400 output tokens. Ninety-two sessions at roughly four turns per minute for nine hours came to about 3.1 billion tokens at Claude Sonnet pricing.
- fix: the founding engineer deploys a patched container image that wraps the stop hook body in try/except, logs the exception, and returns a structured continue=False decision with a human-readable stop reason. They then call UpdateAgentRuntime to lower maxLifetime from 28800 to 600 seconds for one hour, which drains the stuck sessions. They add a DynamoDB session registry and a Lambda that marks sessions older than thirty minutes for a graceful stop request from the chat router. Finally they enable a new CloudWatch alarm on per-runtime session-seconds with a threshold tuned to expected daily volume.
- contributing_factors:
  - AgentCore does not provide a ListActiveSessions or ForceEndSession API. The only lever is deploying a new configuration and waiting for sessions to go idle.
  - The team assumed the default idleRuntimeSessionTimeout of 900 seconds would act as a cost backstop. It cannot, because a runaway agent is never idle.
  - The stop hook was merged without a test for non-UTF8 tool outputs. The scraping tool returns arbitrary bytes from the public web.
  - There was no per-session or per-runtime cost alarm. The only guardrail was the account-wide billing alarm, which fired after fourteen hundred dollars of damage.
  - The agent framework's default behavior of echoing exception tracebacks back into the scratchpad was never audited as an attack surface.
