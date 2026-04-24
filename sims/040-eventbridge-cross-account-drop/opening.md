Quillmark Publishing, Thursday 09:00 UTC. A P2 ticket lands in the platform team's queue: "New product account (444455556666) shows zero audit events for the past 48 hours. Rule shows Enabled. Invocations are climbing. No errors in CloudWatch."

The central audit pipeline has collected access events from 8 product accounts for six months without interruption. The ninth account was onboarded 48 hours ago. Its EventBridge forwarding rule is Enabled and the Invocations metric is rising. FailedInvocations is flat at zero. The central audit Lambda has logged nothing from this account.

No DLQ. No Lambda errors. No resource policy denials.

You have access to EventBridge consoles for both the source account (444455556666) and the central audit account (111122223333), plus CloudWatch and CloudTrail in both accounts.

Where do you start?
