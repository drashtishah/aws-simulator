Forkfield Logistics, Thursday 06:12 AM. Every shipment-tracking dashboard at every Forkfield enterprise customer stops updating at the same minute. Carriers that rely on the real-time API start returning stale positions.

At 06:04 the on-call paged the primary SRE: "forkfield-prod-tracking stack is gone." Not failing. Gone. CloudFormation shows the stack status as DELETE_COMPLETE. Route 53 still has the record but there is nothing on the other side.

The AWS DevOps Agent run that preceded it has a green check mark in the Amazon Q console. Its plan was titled "Fix drift in forkfield-staging-tracking." It ran at 06:00. It finished at 06:04.

Where do you start?
