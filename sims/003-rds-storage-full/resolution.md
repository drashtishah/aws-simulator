---
tags:
  - type/resolution
  - service/rds
  - service/cloudwatch
  - service/ec2
  - difficulty/foundational
  - category/data
---

# Resolution: The CropSync Harvest Crisis -- Database Full

## Root Cause

The RDS MySQL instance `cropsync-prod-db` (db.t3.medium, 20GB gp3 storage) ran out of disk space. Rapid data growth from IoT sensors, accumulated binary logs (3.2GB), and verbose slow query logs (1.8GB) consumed all 20GB of allocated storage. When FreeStorageSpace reached zero, MySQL rejected all write operations with "The table is full" errors.

## Timeline

| Time | Event |
|---|---|
| 6 months ago | RDS instance provisioned with 20GB gp3 storage |
| 2 weeks ago | Developer enables verbose slow query logging for debugging |
| Day 0, 13:48 UTC | FreeStorageSpace drops below 100MB |
| Day 0, 14:02 UTC | FreeStorageSpace reaches 0 bytes; all write operations begin failing |
| Day 0, 14:12 UTC | Application health checks start reporting unhealthy (write test fails) |
| Day 0, 14:17 UTC | PagerDuty alert fires; on-call engineer paged |
| Day 0, 14:32 UTC | Root cause identified: CloudWatch FreeStorageSpace = 0 |
| Day 0, 14:35 UTC | Storage modification initiated: 20GB -> 50GB (applied immediately) |
| Day 0, 14:41 UTC | Storage expansion complete; write operations resume |

## Correct Remediation

1. **Immediate**: Increase allocated storage from 20GB to 50GB via the RDS console (Modify DB Instance -> Storage -> Apply Immediately)
2. **Cleanup**: Purge accumulated binary logs with `CALL mysql.rds_set_configuration('binlog retention hours', 24)` and disable verbose slow query logging
3. **Prevention**: Enable RDS storage auto-scaling with a maximum storage threshold (e.g., 100GB)
4. **Detection**: Create a CloudWatch alarm on the `FreeStorageSpace` metric with a warning threshold at 4GB and critical at 2GB
5. **Process**: Add storage capacity planning to the monthly operations review

## Key Concepts

### RDS Storage

RDS instances use Amazon EBS volumes for storage. Key facts:

- Storage is allocated at instance creation time and can be increased (never decreased) at any time
- Storage modifications can be applied immediately with no downtime for most instance types
- Three storage types: gp3 (general purpose SSD), io2 (provisioned IOPS SSD), and magnetic (previous generation)
- When an RDS instance runs out of storage, the database engine cannot write data, create temporary files, or maintain transaction logs

### RDS Storage Auto-Scaling

Storage auto-scaling automatically increases storage when free space drops below a threshold:

- Triggered when free storage falls below 10% of allocated storage AND the low-storage condition lasts at least 5 minutes AND at least 6 hours have passed since the last storage modification
- You set a maximum storage threshold to control costs
- Available for MySQL, PostgreSQL, MariaDB, Oracle, and SQL Server engines
- Does not require downtime

### CloudWatch RDS Metrics

Critical RDS metrics for operational monitoring:

- `FreeStorageSpace` -- bytes of available storage (the most important metric for this scenario)
- `DatabaseConnections` -- number of client connections
- `CPUUtilization` -- percentage of CPU used by the database process
- `ReadIOPS` / `WriteIOPS` -- read and write operations per second
- `FreeableMemory` -- available RAM on the instance

## AWS Documentation Links

- [RDS Storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html)
- [RDS Storage Auto-Scaling](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIOPS.StorageTypes.html#USER_PIOPS.Autoscaling)
- [Modifying an RDS DB Instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.DBInstance.Modifying.html)
- [CloudWatch Metrics for RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/monitoring-cloudwatch.html)
- [RDS Best Practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_BestPractices.html)

## Learning Objectives

1. **RDS storage model**: Understand that RDS instances have a fixed storage allocation that must be monitored and can be increased without downtime
2. **CloudWatch monitoring**: The FreeStorageSpace metric is critical for RDS health -- always set an alarm on it
3. **Storage auto-scaling**: RDS storage auto-scaling is a simple prevention mechanism that automatically increases storage when free space is low

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: Design High-Performing Architectures
- [[catalog]] -- rds, cloudwatch, ec2 service entries
