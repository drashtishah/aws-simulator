Saltmarsh Supply, Wednesday 11:42. The 3PL warehouse manager calls the Platform lead, confused: "We've had zero pick tickets since nine this morning. Are you guys down?"

Saltmarsh's website is up. Checkout is accepting orders. Stripe has taken 640 payments today. The saltmarsh-new-orders SQS queue has 640 messages in it and the oldest is two and a half hours old.

The fulfill-order Lambda has been invoked exactly zero times today. Its error count is also zero. CloudWatch shows a healthy green service that is simply not running.

The only change in the last week is a cutover from a Lambda-polling-SQS pattern to an EventBridge Pipe, deployed Tuesday evening.

Where do you start?
