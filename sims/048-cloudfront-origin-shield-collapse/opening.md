# Opening: The Premiere That Bent the Cache

It is Friday, 21:04 PT. The drama series The Glasshouse went live four
minutes ago. PrismStream serves 38 million subscribers across 190 countries,
and the marketing team has been trailering this premiere for six weeks.

You are the on-call CDN engineer. PagerDuty has fired three times in the
last ninety seconds:

- `prismstream-cdn: 5xx ratio 7.2% on dist EDFDVBD6EXAMPLE (threshold 0.5%)`
- `prismstream-segments-prod: S3 503 SlowDown rate 4.1k/min`
- `prismstream-cs: 1,840 viewer reports referencing The Glasshouse only`

The CloudFront distribution health check is green. Other shows are streaming
fine. The Glasshouse is the only title affected. The CMO is in a watch
party. The TV news website that covers streaming has already noticed.
