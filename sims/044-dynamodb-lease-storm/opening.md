# Opening: The Lease That Would Not Release

It is Friday, 11:14am Pacific. You are the SRE on call for Polestar Returns, a
Series C e-commerce reverse-logistics platform that processes returns for 1,200 retailers.
Your phone has been buzzing for nine hours.

The nightly batch pipeline that classifies return events crashed at 02:14am with
PagerDuty INC-20260424-0214: `polestar-return-classifier error rate > 50%`. The on-call
SRE before you bounced the workers four times and scaled them up twice. The SQS backlog
on `polestar-returns-queue` is at 4,234,118 messages and has not moved in nine hours.

Lambda Invocations on `polestar-return-classifier` are running at 800 per second,
sustained. Lambda Duration p50 is 4,800 milliseconds, suspiciously close to the
5,000ms timeout. DynamoDB ConditionalCheckFailedRequests on `polestar-shard-leases`
is at 8,000 per second. The last successfully processed record was at 02:13:58.

Your job: find why workers are spinning without doing useful work, drain the backlog,
and stop the pattern from recurring.
