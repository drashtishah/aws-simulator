Canopy Goods, 8:15 AM Wednesday. Your support queue has 11 tickets in 33 minutes, all the same complaint: two identical charges, two Stripe receipts, one order.

The first came in at 7:42. A customer named Priya sent a screenshot: $67.40 charged twice, receipts timestamped 47 seconds apart, the same order ID on both.

By 8:00, ten more. Your head of ops just Slacked the engineering channel: "Is this a Stripe bug or ours?"

The pattern is consistent across every ticket: large grocery baskets, duplicate confirmation emails, two delivery slot reservations. Small orders from the same morning look clean.

`canopy-process-order` is the Lambda that handles fulfillment. `canopy-order-queue` is the SQS queue feeding it.

Your CloudWatch dashboard shows Lambda invocation count running higher than the number of orders placed. Concurrent executions spiked around 7:30, right when the first affected orders came through.

Refunds take 3-5 business days. Customer trust does not wait that long.

Where do you start?
