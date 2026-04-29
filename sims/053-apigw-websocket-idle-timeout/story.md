---
tags:
  - type/simulation
  - service/api-gateway
  - service/lambda
  - service/dynamodb
  - service/cloudwatch
  - difficulty/associate
  - category/networking
---

# Ten Minutes of Silence

## Opening

- company: Vaultlinen
- industry: B2B team messaging
- product: Chat tool for ops/customer-success teams; positioning is "the chat tool that does not lose your thread"
- scale: 38 engineers, 3,200 workspaces, 142,000 daily active users, peak 38,000 concurrent connections
- time: Thursday 16:22 ET
- scene: On-call backend engineer, support has routed 318 tickets to engineering today
- alert: "vaultlinen-cs: 318 tickets matching 'missed messages' or 'disconnect every 10 min' since 09:00"
- stakes: Brand positioning is reliability; two tickets from VPs at major customers; CEO wants an update by EOD
- early_signals:
  - Tickets cluster on disconnects after exactly 10 minutes of silence, but only for users not typing
  - WebSocket API connection counts and Lambda errors all look healthy
  - Mean connection lifetime fell from 78 minutes a month ago to 9 minutes 48 seconds today
  - Active typers do not show up in tickets; readers do
  - Reconnect appears to succeed but is silent; users only realize they were offline when they refresh
- investigation_starting_point: All chat connections terminate at API Gateway WebSocket API vaultlinen-chat. There are three Lambdas: $connect, $disconnect, $default. Connection state lives in DynamoDB table vaultlinen-connections. The web client is a React SPA; the iOS and Android clients are native. None of the clients send any kind of heartbeat ping. The traffic shape changed three months ago when Vaultlinen added a "watch threads silently" feature that lets users keep tabs open without typing.

## Resolution

- root_cause: API Gateway WebSocket has a fixed 10-minute idle timeout that cannot be raised. Vaultlinen's clients have no application-layer heartbeat. Active typers send messages every few seconds and stay connected; idle readers send nothing for 10 minutes; API Gateway closes the connection with status 1001 (client inactivity); the JS reconnect logic silently re-establishes the connection but the missed messages between disconnect and reconnect are not refetched, so users see a stale UI until they manually navigate away and back.
- mechanism: Three months ago Vaultlinen launched "watch threads silently," a feature that encourages keeping multiple workspace tabs open without active engagement. This shifted the traffic distribution toward idle readers. The mean connection duration began to fall: 78 min three months ago, 38 min two months ago, 14 min one month ago, 9 min 48 sec today. The shape of the failure was masked because clients reconnect silently and the connection-count metric stayed stable (each lost connection is replaced by a new one). What surfaced was the consequence: users missing messages that arrived during the gap.
- fix: Two-stage. (1) Ship application-layer heartbeat in the next client release: every 5 minutes the client sends `{"action":"ping"}`. Server $default route accepts the action and no-ops. With this in place, idle users no longer disconnect at 10 minutes. (2) Improve reconnect UX: when the WebSocket is in CLOSING or CLOSED state, show a small banner. On reconnect, fetch all messages newer than the last received message. With both shipped, "missed messages while reading" goes away and users see explicit indicators of connection state.
- contributing_factors:
  - "Watch threads silently" feature shifted traffic toward idle connections without anyone re-evaluating the WebSocket platform's idle timeout
  - No heartbeat was added because the original product use case was active turn-taking chat where idle was rare
  - Reconnect logic was implemented but UX-incomplete: silent reconnect plus no missed-message refetch
  - Mean connection lifetime metric existed but was not alarmed; it would have flagged the regression month-over-month
  - API Gateway WebSocket was chosen for its managed cost profile; the 10-minute timeout was acceptable when the product launched but is not now
