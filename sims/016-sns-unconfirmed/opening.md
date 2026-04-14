Clarabridge Analytics. 10:52 AM, Wednesday. Your ops lead read about the outage on Twitter, mid-standup, from a customer tweet: "anyone else seeing stale data on @clarabridge dashboards? Our revenue numbers haven't updated in an hour."

No alert arrived. No email, no Slack message, no text. The CloudWatch alarm `clarabridge-ingest-error-rate` entered ALARM state at 10:07 AM, forty-five minutes ago.

890 customers pay for real-time data. Support tickets are opening. Your ops lead, Marcus, has muted the standup and is looking directly at you.

"The alarm did its job," he says. "So why did we find out from Twitter?"

The SNS topic `clarabridge-ops-alerts` is your first stop. What do you check?
