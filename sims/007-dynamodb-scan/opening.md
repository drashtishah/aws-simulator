Tidepool Goods, Portland. Tuesday, 10:17 AM.

Your PagerDuty fired nine minutes ago: CRITICAL, `tidepool-products`, ProvisionedThroughputExceededException on every write attempt.

The CloudWatch dashboard shows consumed read capacity pinned at 100 RCUs. It has not moved in seventeen minutes.

The order-writer Lambda is failing on every invocation. Messages are routing to the dead-letter queue.

Kenji from customer service just messaged the engineering channel: buyers are emailing in, orders are not going through, and he has no estimate to give them.

The `tidepool-products` table is your starting point. Where do you look first?
