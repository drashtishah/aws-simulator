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

1. **Immediate**: Give the database more disk space right away. Increase the allocated storage from 20GB to 50GB through the RDS console (Modify DB Instance -> Storage -> Apply Immediately). For most database types, this does not cause any downtime -- the database keeps running while the storage expands.
2. **Cleanup**: Free up space consumed by log files. Purge accumulated binary logs (files the database writes to record every change, used for backups and replication) by running `CALL mysql.rds_set_configuration('binlog retention hours', 24)` to keep only the last 24 hours. Also turn off the verbose slow query logging that was left on after debugging.
3. **Prevention**: Turn on RDS storage auto-scaling with a maximum storage threshold (for example, 100GB). Auto-scaling automatically adds more disk space when free space drops below 10% of the total, so the database never runs out unexpectedly.
4. **Detection**: Set up an early warning system. Create a CloudWatch alarm on the `FreeStorageSpace` metric that alerts your team when space drops below 4GB (warning) and 2GB (critical). This gives you time to act before the database fills up completely.
5. **Process**: Add a monthly review of database storage trends to your operations routine. Checking how fast storage is growing lets you plan ahead instead of reacting to emergencies.

## Key Concepts

### RDS Storage -- How Your Database's Disk Space Works

RDS (Relational Database Service) is a managed database service. Your database stores its data on EBS volumes (Elastic Block Store -- basically virtual hard drives in the cloud). Key facts:

- You choose how much disk space to allocate when you create the database. You can increase it later, but you can never decrease it.
- Adding more storage can be done immediately, with no downtime for most database types -- the database keeps running while the disk grows.
- Three storage types are available: gp3 (general purpose SSD -- good for most workloads), io2 (high-performance SSD for demanding applications), and magnetic (older, slower, cheaper).
- When the database runs out of disk space, it can no longer write any data, create temporary files, or maintain its internal logs. All write operations fail.

### RDS Storage Auto-Scaling -- Automatic Disk Expansion

Storage auto-scaling is a feature that automatically adds more disk space when the database starts running low. It prevents the "disk full" emergency this sim is about:

- It kicks in when free storage drops below 10% of the total AND the low-storage condition lasts at least 5 minutes AND at least 6 hours have passed since the last storage increase.
- You set a maximum limit to control costs -- auto-scaling will not grow beyond this ceiling.
- Works with MySQL, PostgreSQL, MariaDB, Oracle, and SQL Server.
- No downtime required when storage expands.

### CloudWatch RDS Metrics -- What to Monitor

CloudWatch (AWS's monitoring service) collects metrics from your database. The most important ones for operational health:

- `FreeStorageSpace` -- how many bytes of disk space remain. This is the most critical metric for this scenario. When it hits zero, writes fail.
- `DatabaseConnections` -- how many applications or users are connected to the database at once.
- `CPUUtilization` -- what percentage of the database server's processing power is being used.
- `ReadIOPS` / `WriteIOPS` -- how many read and write operations per second the database is performing.
- `FreeableMemory` -- how much RAM (working memory) is available on the database server.

## Other Ways This Could Break

### InnoDB temporary tablespace exhaustion

Instead of your actual data filling the disk, a temporary file used by the database engine (called ibtmp1) grows out of control. This happens when the database runs long or complex queries that need scratch space for sorting or joining large datasets. The error message mentions `/rdsdbdata/tmp/` paths instead of your own tables. Restarting the database reclaims the space, but the real fix is optimizing those queries or limiting how much temporary space the database can use. To prevent this, monitor FreeStorageSpace alongside how long queries take. In the parameter group (the database's configuration settings), set bounded values for `temptable_max_ram` and `temptable_max_mmap` to cap temporary space usage.

### RDS instance reaches maximum allocated storage limit

Storage auto-scaling is turned on, but the maximum limit was set too low. Auto-scaling stops adding space once it hits that ceiling, even if data keeps growing. The tricky part is that alerts might not fire because auto-scaling appeared to be handling the situation -- until it hit the ceiling and could not add more. Set the maximum storage limit to at least 26 percent above your current usage and review it every few months as your data grows.

### Binary log replication lag filling storage on a read replica

The primary database has plenty of space, but its read replica (a copy of the database used for handling read-only traffic) falls behind on processing changes. The unprocessed change logs (called relay logs) pile up on the replica and fill its disk. Write failures only show up on the replica, not the primary, which makes this confusing to diagnose. Monitor FreeStorageSpace on every replica individually (not just the primary), keep binary log retention as short as acceptable, and set up an alert on ReplicaLag -- a metric that shows how far behind the replica is.

## SOP Best Practices

- Always turn on storage auto-scaling when you create a production database. Set the maximum storage limit high enough to cover at least 6 months of expected data growth. Auto-scaling automatically adds disk space when free space gets low, so you never run out unexpectedly.
- Set up a CloudWatch alarm on FreeStorageSpace for every database the moment you create it -- do not wait until after the first storage emergency. Early warnings give you time to act before writes start failing.
- Treat binary log retention and slow query log settings as part of your infrastructure setup, not as temporary debugging switches that someone turns on and forgets. Review these settings in your parameter group (the database's configuration template) to make sure they are not quietly consuming disk space.
- Include database storage trends in your monthly capacity reviews. Checking how fast storage is growing each month lets you spot problems early and plan upgrades before they become emergencies.

## Learning Objectives

1. **RDS storage model**: Understand that RDS instances have a fixed storage allocation that must be monitored and can be increased without downtime
2. **CloudWatch monitoring**: The FreeStorageSpace metric is critical for RDS health -- always set an alarm on it
3. **Storage auto-scaling**: RDS storage auto-scaling is a simple prevention mechanism that automatically increases storage when free space is low

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: Design High-Performing Architectures
- [[catalog]] -- rds, cloudwatch, ec2 service entries
