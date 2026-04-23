Plover Analytics, Monday 09:02 UTC. Four client emails landed in the customer success inbox within five minutes of business hours: dashboard wouldn't load, error message for about 30 seconds, fine on refresh.

The API Gateway execution log for POST /report shows HTTP 504 at 09:00:12. The Lambda log shows "Task timed out after 29.00 seconds" on the same invocation. Every request after 09:00:45 completed normally. The RDS console shows the cluster is healthy and serving queries right now. There are no database error events.

Thirty seconds of silence, once a week, every Monday morning, like clockwork.

Where do you start?
