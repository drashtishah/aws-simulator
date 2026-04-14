9:30 AM. Trellis Health. The appointment booking platform serves 520,000 patients across 12 states, and right now it is failing 39% of them.

The on-call Slack channel shows 43 unread messages. Seven support tickets in the last seven minutes, all reporting the same thing: scheduling pages crawling, availability slots not loading, bookings timing out.

ALB TargetResponseTime is sitting at 8.2 seconds. It was under 200 milliseconds two hours ago.

Your phone buzzes: Priya from product, asking if you are rolling back. She wants a decision in 15 minutes.

The ALB, the ECS cluster, and the RDS instance are all showing healthy in the console. Something between the application and its data is broken.

Where do you start?
