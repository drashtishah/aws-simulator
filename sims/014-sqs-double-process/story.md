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

company: Canopy Goods
industry: grocery delivery, seed-stage startup, 11 engineers, 18 months old
product: grocery delivery in Austin, order processing via SQS queue and Lambda
scale: 12,000 active customers, 2,800 orders on a normal day, $340,000 monthly gross merchandise value
time: 8:15 AM, Wednesday
scene: morning after a promotional campaign (20% off orders over $50), which brought in larger-than-usual baskets (20-30 items)
alert: customer email at 7:42 AM reporting duplicate charge -- two identical Stripe receipts for $67.40, timestamped 47 seconds apart, same order ID
stakes: 11 customers reported duplicate charges by 8:15 AM, refund requests stacking up in support tool, customer trust at risk
early_signals:
  - two successful Stripe charges for the same order, seconds apart, different request IDs
  - pattern repeats across all affected orders: same order ID charged twice
  - Lambda concurrent executions spiking beyond what order volume explains
  - invocation count higher than the number of orders placed
  - duplicate charges only affecting large orders (20+ items), small orders seem fine
  - backend is a single SQS queue (canopy-order-queue) feeding a single Lambda function (canopy-process-order)
  - Lambda processes each order: inventory check, payment charge, delivery slot reservation, confirmation email
investigation_starting_point: backend engineer, 8:15 AM Wednesday. Promotional campaign yesterday brought in large baskets. Duplicate charges started this morning but only for some orders. Small orders seem fine. Need to find why customers are being charged twice and stop it.

## Resolution

root_cause: SQS queue canopy-order-queue had a visibility timeout of 30 seconds (the default, never changed when the queue was created 8 months ago), while the Lambda function needed 60-90 seconds to process large orders from the promotional campaign
mechanism: at the 30-second mark, the Lambda was still processing the large order, but SQS assumed the message was lost and made it visible again. A second Lambda invocation picked it up. Both invocations completed successfully -- both charged the customer, both reserved a delivery slot, both decremented inventory. No idempotency check existed in the function.
fix: three changes. (1) Increase visibility timeout to at least 6x the Lambda timeout (540 seconds, per AWS recommendation). (2) Configure a dead-letter queue with maxReceiveCount of 3 so genuinely failed messages are captured instead of retrying indefinitely. (3) Add idempotency check at the start of the Lambda function -- query orders table for order ID before processing, skip if already charged.
contributing_factors:
  - visibility timeout left at 30-second default, never reviewed against actual processing time
  - no dead-letter queue configured, so failed messages were invisible
  - no idempotency logic in the Lambda function to detect duplicate processing
  - promotional campaign changed the order size distribution, pushing processing time past the visibility timeout
  - average order previously 5-8 items (7-9 seconds to process), well within the 30-second timeout
