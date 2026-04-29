# Opening: The Answer That Arrived All at Once

It is Wednesday, 09:42 ET. Yesterday at 22:00 UTC the platform team
migrated chat.latticelens.example from an Application Load Balancer to an
API Gateway REST API to centralize auth and per-tenant throttling.

You are the on-call backend engineer. The customer-success queue has 184
new tickets in the last six hours. They all describe the same thing:

- "I ask Latticelens a question, the cursor blinks for thirty seconds, then
  the entire answer appears at once. Sometimes the answer never arrives and
  I get a 504."
- "Streaming used to work. Did you turn it off?"

Latticelens has 84,000 paid users on Pro tiers. Reddit is starting to
notice. The product is an AI workspace assistant; "the typing animation"
is a brand differentiator the founders talk about in podcasts.

Your dashboards show:
- chat-completions Lambda success rate is 98.4% (was 99.97% before yesterday)
- API Gateway 5xxError rate spiked at 22:00 UTC; baseline is 0.02%, current is 1.6%
- Lambda durations are up by 3.8x median (from 4.2s to 16s)
- Bedrock InvokeModelWithResponseStream metrics: invocations up 4%, errors flat
