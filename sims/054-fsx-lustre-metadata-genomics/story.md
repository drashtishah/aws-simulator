---
tags:
  - type/simulation
  - service/batch
  - service/fsx-lustre
  - service/s3
  - service/ec2
  - service/cloudwatch
  - difficulty/professional
  - category/performance
---

# Twelve Hundred Workers, One Directory

## Opening

- company: Helixprime
- industry: Precision medicine, clinical genomics
- product: Whole-genome variant calling for oncology treatment recommendations
- scale: 84 engineers + 41 bioinformaticians, 280 patient samples per night, 4 alignment workers per sample, 1,200 spot EC2 instances per pipeline run
- time: Tuesday 02:48 ET, mid-pipeline run
- scene: On-call platform engineer, pipeline started 48 min ago and has stalled for the last 14 min
- alert: "helixprime-pipeline: alignment stage stalled for 14 minutes; ETA missed; 280 samples queued"
- stakes: Clinical team begins reviews at 07:00 ET; if alignment misses the deadline, treatment recommendations slip 24 hours; oncologists have to call patients to delay; CMO is the escalation contact
- early_signals:
  - 1,200 Batch workers are RUNNING but at 0.4% average CPU
  - FSx for Lustre throughput utilization is 8%
  - No errors in Batch, no exceptions in worker logs, no spot reclamation events
  - The pipeline has worked nightly for 11 months; tonight is the first stall
  - This week's samples include 60 new specimens that doubled the total reference index file count from 24 to 47
- investigation_starting_point: The pipeline runs BWA-MEM alignment in 1,200 spot containers via AWS Batch. Each container mounts FSx for Lustre at /fsx and reads its sample shard from S3 (mirrored to /fsx/samples/ via data-repository association), opens the reference genome from /fsx/refs/hg38/, and emits aligned BAM to /fsx/output/. The reference directory was extended this week to add additional indexes for new specimens. Compute environment uses SPOT_CAPACITY_OPTIMIZED across c6i, c6a, c5 4xlarge sizes.

## Resolution

- root_cause: The FSx for Lustre file system has 12,000 metadata IOPS provisioned (AUTOMATIC mode based on 9.6 TiB SSD storage). The pipeline launches 1,200 alignment workers concurrently; each worker opens all 47 files in /fsx/refs/hg38/ at startup. That is 56,400 file-open syscalls hitting the metadata server in the first 30 seconds, against a 12,000 IOPS ceiling. Workers block at file open, sitting at zero CPU. Throughput utilization is 8% because no one is actually reading file content yet; everyone is waiting on metadata.
- mechanism: Until this week the reference directory contained 24 files. 1,200 workers x 24 = 28,800 opens in the startup window, which fit within the metadata IOPS budget with some elbow room. This week's 60 new specimens required additional reference indexes, growing the directory to 47 files. 1,200 x 47 = 56,400 opens, well over the 12,000 IOPS ceiling. Even with steady-state amortization the open() syscalls queued up and the metadata server's queue depth grew unboundedly. After 14 minutes of partial progress, the queue had not drained; workers that had been waiting were still waiting; and CPU stayed at zero across the fleet.
- fix: Two changes. (1) Switch FSx metadata configuration to USER_PROVISIONED at 96,000 IOPS using `aws fsx update-file-system`. The change is non-disruptive; metadata throughput climbs from 12k to 96k within minutes; queued open() syscalls drain; workers move past file open into actual alignment work. (2) Pre-stage the reference genome and indexes to instance NVMe at worker startup (parallel pull from S3) so future runs do not contend on FSx metadata for reference reads at all. Reference is read-only and shared across workers, so a per-instance copy is cheap. With both changes, the run completes by 04:38 ET, in time for the 07:00 clinical review.
- contributing_factors:
  - The reference directory was extended this week to support 60 new specimens; nobody noticed the change pushed the open-rate over the metadata IOPS ceiling
  - FSx metadata configuration was AUTOMATIC, which sized for storage capacity rather than for actual fan-out at job startup
  - There were no CloudWatch alarms on FSx MetadataOperations or MetadataOperationLatency
  - The pipeline architecture concentrated all reference files in one directory, maximizing lock contention
  - The Batch dashboard showed all jobs RUNNING, which masked the fact that they were all blocked on I/O
