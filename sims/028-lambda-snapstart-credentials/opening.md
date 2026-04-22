Tidewater Pay, Wednesday 06:11 AM. The overnight on-call engineer gets paged: payment webhooks from the West Coast start returning 500 errors in bursts. Not a steady rate. Spikes every few minutes, then silence.

In CloudWatch, the payments Lambda's Errors metric climbs from zero to four hundred in fifteen minutes. The Lambda Duration is fine. The DynamoDB tables are fine. The only recent change was enabling SnapStart on the function six days ago to knock the 1.4-second cold start down to 80 ms.

Logs show the same stack trace every time. ExpiredTokenException on a DynamoDB PutItem. The credentials supposedly expire six hours from now.

Where do you start?
