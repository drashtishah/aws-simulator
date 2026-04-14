Canopy Goods, 8:15 AM Wednesday. Your support queue has 11 tickets in 33 minutes, all the same complaint: two identical charges, two Stripe receipts, one order.

A customer sent a screenshot: $67.40 charged twice, receipts timestamped 47 seconds apart, the same order ID on both. Ten more tickets followed by 8:00.

The pattern is consistent: large grocery baskets, duplicate confirmation emails, two delivery slot reservations. Small orders look clean.

Your head of ops Slacks the engineering channel: "Is this a Stripe bug or ours?"

Order fulfillment runs through the `canopy-process-order` Lambda, fed by the `canopy-order-queue` SQS queue. Refunds take 3-5 business days. Customer trust does not wait that long.

Where do you start?
