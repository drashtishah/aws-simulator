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

## Other Ways This Could Break

### InnoDB temporary tablespace exhaustion

The ibtmp1 file grows unbounded during long-running queries or large sorts. The error message references `/rdsdbdata/tmp/` paths instead of user tables. A restart reclaims the space, but the root fix is optimizing queries or increasing `temptable_max_mmap`. To prevent this, monitor FreeStorageSpace alongside query duration and set `temptable_max_ram` and `temptable_max_mmap` to bounded values in the parameter group.

### RDS instance reaches maximum allocated storage limit

Storage auto-scaling is enabled but the maximum storage threshold is set too low, so auto-scaling stops before the workload stops growing. The alarm may not fire because the condition appeared to be handled. Set the maximum storage threshold to at least 26 percent above current allocation and review the threshold quarterly as data grows.

### Binary log replication lag filling storage on a read replica

The primary instance has space, but the read replica falls behind on applying relay logs, which accumulate and fill the replica's storage. Write failures appear only on the replica, not the primary. Monitor FreeStorageSpace on every replica separately, set binlog retention hours to the minimum acceptable window, and alert on ReplicaLag.

## SOP Best Practices

- Always enable storage auto-scaling on production RDS instances and set a maximum storage threshold that accounts for at least 6 months of projected growth
- Create CloudWatch alarms on FreeStorageSpace for every RDS instance at provisioning time, not after the first incident
- Treat binary log retention and slow query log settings as infrastructure configuration, not developer debugging toggles -- review them in your parameter group baseline
- Include RDS storage utilization trends in monthly capacity planning reviews so growth is visible before it becomes an emergency

## Learning Objectives

1. **RDS storage model**: Understand that RDS instances have a fixed storage allocation that must be monitored and can be increased without downtime
2. **CloudWatch monitoring**: The FreeStorageSpace metric is critical for RDS health -- always set an alarm on it
3. **Storage auto-scaling**: RDS storage auto-scaling is a simple prevention mechanism that automatically increases storage when free space is low

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: Design High-Performing Architectures
- [[catalog]] -- rds, cloudwatch, ec2 service entries
