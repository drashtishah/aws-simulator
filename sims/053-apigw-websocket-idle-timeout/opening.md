# Opening: Ten Minutes of Silence

It is Thursday, 16:22 ET. Vaultlinen, a B2B team messaging product, has
142,000 daily active users. You are the on-call backend engineer.

Customer support routed 318 tickets to engineering today. Every ticket is
some flavor of:

- "I had Vaultlinen open in a tab and I missed three messages from my
  manager. The connection icon never showed me as offline. I clicked the
  thread and the messages were there."
- "Vaultlinen disconnects me every ten minutes if I am reading and not
  typing. Slack does not do this."
- "I had a customer call open in another tab and missed eight messages
  from my support handoff. They thought I was ignoring them."

Vaultlinen's brand is "the chat tool that does not lose your thread." Two
of the tickets came from VPs at major customers. The CEO has asked for an
update before close of business.

Your dashboards say:
- WebSocket API connection count: stable, ~32k concurrent
- Lambda errors: zero on $connect, $default, $disconnect
- DynamoDB vaultlinen-connections: no errors, no throttling
- Mean connection lifetime: 9 minutes 48 seconds (was 78 minutes one month ago)
