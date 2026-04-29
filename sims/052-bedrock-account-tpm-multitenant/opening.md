# Opening: The Tenant Who Drank the Pool

It is Tuesday, 09:48 UTC. You are the on-call platform engineer at Quirescript,
a B2B AI knowledge platform. 87 enterprise tenants pay for branded AI
assistants that answer questions against their internal docs.

PagerDuty fires twice in five minutes:
- `quirescript-api: 5xx error rate jumped from 0.04% to 14.2% across all tenants`
- `quirescript-cs: 41 tenant slack channels mention 429 errors in last 10 min`

You pull up the dashboards. The picture is strange:
- API Gateway custom domain api.quirescript.example: per-key throttle
  counters all show zero (no tenant exceeded their per-key rate)
- API Gateway 5XX rate is 14.2%; 4XX rate (which would include 429s
  from the gateway) is at baseline
- invoke-model Lambda errors are spiking; the error message is
  "ThrottlingException: Too many tokens, please wait before trying again"

The 429s are not coming from your gateway. They are coming from Bedrock.

One tenant, Northwind Logistics, kicked off a backfill job at 09:14 UTC
to summarize 2.6 million historical support tickets. They told you about
it last week and it was approved.
