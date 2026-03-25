---
tags:
  - type/simulation
  - service/sqs
  - service/lambda
  - service/cloudwatch
  - difficulty/associate
  - category/reliability
---

# The Queue Nobody Watched

## Opening

The first support email arrived at 7:42 AM. "I was charged twice for my grocery order." The customer attached a screenshot of two identical Stripe receipts, $67.40 each, timestamped 47 seconds apart. The order ID was the same on both.

Canopy Goods delivers groceries in Austin. Twelve thousand active customers. Two thousand eight hundred orders on a normal day. Three hundred forty thousand dollars in monthly gross merchandise value. The company is eleven engineers, seed-stage, eighteen months old. The backend is a single SQS queue feeding a single Lambda function. Orders come in through the API, land in the queue, and the Lambda processes them one at a time: inventory check, payment charge, delivery slot reservation, confirmation email.

By 8:15 AM, eleven customers had reported duplicate charges. The pattern was the same each time. Two successful Stripe charges for the same order, seconds apart, different request IDs. The support tool showed refund requests stacking up. The co-founder pulled up CloudWatch and saw Lambda concurrent executions spiking in a way that did not match the order volume. The invocation count was higher than the number of orders placed.

You are the backend engineer. It is 8:15 AM on Wednesday. Yesterday the marketing team ran a promotional campaign -- twenty percent off orders over $50. The campaign brought in larger-than-usual baskets. Twenty items, thirty items. The duplicate charges started this morning, but only for some orders. Small orders seem fine. You have been asked to find why customers are being charged twice and stop it.

## Resolution

The SQS queue `canopy-order-queue` had a visibility timeout of 30 seconds. It was the default. Nobody changed it when the queue was created eight months ago. For most of that time, it did not matter. The average order was five to eight items. The Lambda function processed those in seven to nine seconds. The message was deleted long before the visibility timeout expired.

Wednesday's promotional campaign changed the distribution. Large orders -- twenty, twenty-five, thirty items -- required individual inventory checks, a longer payment processing call, and delivery slot reservation logic that scaled with basket size. The Lambda function needed 60 to 90 seconds for those orders. At the 30-second mark, the function was still running, but SQS assumed the message was lost. It made the message visible again. A second Lambda invocation picked it up. Both invocations completed successfully. Both charged the customer. Both reserved a delivery slot. Both decremented inventory. The function had no idempotency check -- no logic to ask whether an order had already been processed.

The fix was three changes. First, increase the visibility timeout to at least six times the Lambda timeout -- AWS recommends this ratio -- bringing it to 540 seconds. Second, configure a dead-letter queue with a `maxReceiveCount` of 3, so that messages which genuinely fail processing are captured instead of retrying indefinitely. Third, add an idempotency check at the start of the Lambda function: query the orders table for the order ID before processing, and skip execution if the order has already been charged. The visibility timeout fix stopped the immediate bleeding. The idempotency check made the system correct regardless of delivery guarantees. The dead-letter queue made failures visible.
