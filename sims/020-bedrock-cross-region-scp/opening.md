Polaris Underwriting, 2:47 PM Wednesday. Claims adjusters have been filing tickets for the past thirty minutes: roughly one in three AI assessments is failing, no pattern in the claims themselves.

CloudWatch shows a Bedrock InvocationErrors rate of 31.2%. It has held exactly there for six hours.

847 claims are queued. The four-hour SLA is already broken for 200 of them. Twelve adjusters switched to manual review at 11 minutes per claim and the math does not close.

Your SRE lead, Priya, just pinged: "IAM role unchanged, Lambda code unchanged, Bedrock model access unchanged. Same document submitted twice: one succeeds, one fails. I have no idea what layer this is coming from."

The errors all return AccessDeniedException.

Where do you start?
