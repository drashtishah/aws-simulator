# Opening: Twelve Hundred Workers, One Directory

It is Tuesday, 02:48 ET. Helixprime runs whole-genome variant calling for
280 oncology patient samples per night. Results need to be ready for the
clinical team by 07:00 ET because that is when oncologists begin reviewing
treatment recommendations.

You are the on-call platform engineer. PagerDuty fired three minutes ago:

- `helixprime-pipeline: alignment stage stalled for 14 minutes`
- `helixprime-pipeline: ETA missed; 280 samples queued`

The pipeline kicked off at 02:00 ET with 280 patient samples. Each sample
spreads across roughly 4 alignment workers, so 1,200 EC2 spot instances
launched. The pipeline normally completes alignment in 90 minutes. Tonight,
40 minutes after launch, every worker is sitting at zero CPU.

Your dashboards show:
- AWS Batch job count: 1,200 RUNNING; 0 PENDING; 0 FAILED
- EC2 Spot Fleet: 1,200 instances InService, all c6i.4xlarge family
- FSx for Lustre helixprime-fsx-prod: throughput utilization 8%
  (provisioned 9.6 GB/s, actual 768 MB/s)
- CloudWatch instance CPU: averaging 0.4% across the 1,200 workers
- No errors. No exceptions. Just 1,200 idle workers.

The CMO will be reviewing samples in 4 hours.
