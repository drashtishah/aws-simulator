Parable Health, Tuesday 16:08. The billing engineer on-call pings Platform: "charge captures are timing out". The admin portal that was the whole point of last night's deploy works beautifully. RDS Proxy is humming. Database queries are fast. Only Stripe and Slack are unhappy.

Stripe's dashboard shows 31 capture-attempts in the last hour with a Parable integration-test trace, every one of them failing with a network connect timeout. Slack notifications to the #billing channel stopped at 22:47 Monday, which is when the App Runner service was last deployed.

The App Runner service is marked RUNNING. Its CPU and memory graphs are normal. Its 5xx rate is at 4.8 percent, which is elevated but not paged.

Nothing in the billing app's code has changed. The only change in the deploy was the addition of a VPC connector and the flip of EgressType from DEFAULT to VPC.

Where do you start?
