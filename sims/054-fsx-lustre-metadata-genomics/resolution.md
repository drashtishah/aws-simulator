---
tags:
  - type/resolution
  - service/batch
  - service/fsx-lustre
  - service/s3
  - service/ec2
  - service/cloudwatch
  - difficulty/professional
  - category/performance
---

# Resolution: Twelve Hundred Workers, One Directory

## Root Cause

FSx for Lustre's metadata IOPS quota is the scarce resource here, not throughput. The Helixprime file system was provisioned in AUTOMATIC mode with 12,000 metadata IOPS sized for the 9.6 TiB storage allocation. The alignment pipeline launches 1,200 concurrent workers, each opening 47 reference files in `/fsx/refs/hg38/` at startup, for 56,400 file open() syscalls in the first 30 seconds. With a 12,000 metadata IOPS ceiling, those opens queued up; workers blocked; and throughput utilization stayed near zero because no actual file content was being read.

The pipeline had run nightly for 11 months without this problem. The change this week was an extension of the reference directory from 24 files to 47 files to support 60 new specimens. 1,200 × 24 = 28,800 opens fit within budget; 1,200 × 47 = 56,400 opens did not.

## Timeline

| Time (ET) | Event |
|---|---|
| 11 months ago | Pipeline launched with FSx for Lustre AUTOMATIC metadata mode; 24 reference files; ran nightly without issue |
| Last week | New specimen support added; reference directory grows from 24 to 47 files |
| Last week (6 days ago) | First nightly run with 47-file reference; completes successfully but 25 minutes slower than baseline (un-noticed) |
| Today 02:00 | Tonight's pipeline starts with 280 samples, 1,200 alignment workers |
| Today 02:00:15 | Workers begin opening reference files; metadata server queue depth climbs |
| Today 02:00:30 | Metadata IOPS hits 12,000 ceiling; new opens block |
| Today 02:14 | First worker's open() returns after 14 minutes of waiting; barely starts work |
| Today 02:34 | Pipeline detects no progress and PagerDuty alarm fires |
| Today 02:48 | On-call paged |
| Today 02:55 | Engineer checks FSx CloudWatch metrics; MetadataOperations at 12,000 (saturated); throughput at 8% |
| Today 02:58 | Engineer checks file system config; MetadataConfiguration.Mode = AUTOMATIC, Iops = 12000 |
| Today 03:02 | `aws fsx update-file-system` switches to USER_PROVISIONED at 96000 Iops |
| Today 03:06 | New metadata throughput active; queued opens drain in ~90 seconds |
| Today 03:08 | Worker CPU climbs from 0% to 90%+; alignment proceeds |
| Today 04:38 | Pipeline completes; samples ready for 07:00 clinical review |

## Correct Remediation

1. **Confirm workers are stalled at I/O, not crashed**: SSH or Session Manager into one worker. Run `ps aux | grep bwa` and verify the BWA process exists. Check `cat /proc/<pid>/wchan`; if you see something like `inode_dio_wait` or the process state is `D` (uninterruptible sleep), it is blocked on file system I/O.
2. **Compare metadata vs throughput on FSx**: Pull `AWS/FSx` `MetadataOperations` for the file system. If it sits at the configured IOPS ceiling, the metadata server is saturated. Pull `DataReadBytes` and `DataWriteBytes` for context; if those are low while metadata is pegged, the bottleneck is in the metadata path.
3. **Check the file system's metadata configuration**: `aws fsx describe-file-systems --file-system-ids fs-...` returns LustreConfiguration.MetadataConfiguration. Look at Mode (AUTOMATIC or USER_PROVISIONED) and Iops (1500 to 192000). If MetadataOperations is at or near Iops, the metadata server is your bottleneck.
4. **Increase metadata IOPS**:
   ```
   aws fsx update-file-system \
     --file-system-id fs-... \
     --lustre-configuration MetadataConfiguration={Mode=USER_PROVISIONED,Iops=96000}
   ```
   The change is non-disruptive but cannot be reduced afterward; pick a value that gives headroom. Cost scales with metadata IOPS, so do not over-provision wildly. Watch MetadataOperations climb and queue depth fall.
5. **Reduce concentration in a single directory**: Refactor the reference layout so files are spread across several subdirectories (e.g., 16 buckets keyed on a hash of the filename). Update the alignment script to find files in their new location. This reduces lock contention on any one directory's metadata.
6. **Pre-stage hot small files to instance NVMe**: The reference genome and indexes are static and shared across workers, but each worker only needs them locally. On worker startup, pull from S3 (parallel reads from S3 are cheap) to /tmp on the instance NVMe before running the aligner. This eliminates FSx metadata pressure for reference reads entirely.
7. **Add CloudWatch alarms**:
   - `MetadataOperations / Iops > 0.7` as a warning.
   - `MetadataOperationLatency` p99 > 100 ms as a leading indicator of contention.
   - Custom metric on `time_at_zero_cpu` per Batch worker; alarm if more than 50 workers spend more than 5 minutes at near-zero CPU.

## Key Concepts

### FSx for Lustre architecture

A Lustre file system has three roles:

- **Metadata server (MDS)**: handles directory operations, file open/close, locks, permissions. Backed by a metadata target (MDT) on disk.
- **Object storage targets (OSTs)**: hold the actual file content. Files are striped across multiple OSTs for parallel reads.
- **Clients**: mount the file system. They talk to MDS for any metadata op (open, list, stat) and to OSTs directly for data ops (read, write).

The two paths are independent. A workload can be MDS-bound (lots of opens, few bytes) or OST-bound (few opens, lots of bytes) or both. Different workloads need different sizing of each.

### Metadata IOPS vs throughput

Provisioned throughput on FSx for Lustre is the file system's data path bandwidth, set in MB/s/TiB tiers. Metadata IOPS is the file system's metadata path operation rate, set in increments (1500, 3000, 6000, 12000, multiples of 12000 up to 192000 for SSD).

Crucially, throughput dashboards do not reflect metadata pressure. A workload can saturate metadata while showing 8% throughput utilization. The two metrics must be looked at separately.

### AUTOMATIC vs USER_PROVISIONED metadata mode

PERSISTENT_2 file systems can run in two modes:

- **AUTOMATIC**: FSx sizes metadata IOPS based on storage capacity. Works for typical workloads. Cannot exceed the auto-provisioned value without switching modes.
- **USER_PROVISIONED**: explicit Iops value (1500 to 192000). Required for any workload that needs more metadata IOPS than AUTOMATIC would give.

Switch to USER_PROVISIONED is non-disruptive. You cannot decrease Iops once raised. Pick a value with headroom and re-evaluate annually.

### HPC fan-out is a metadata problem

A 1,200-worker fleet that opens 47 files each at startup generates 56,400 metadata operations in seconds. Even at 192,000 IOPS (the Lustre ceiling), this is borderline if all opens are concurrent. The fix is structural: spread files across many directories, or pre-copy to instance-local storage. Throwing more metadata IOPS at the wall is a workable patch but not a long-term answer for ever-growing fleets.

## Other Ways This Could Break

### Lustre stripe count too low for parallel reads

Workers can read but throughput is capped because each file is striped across only one OST. Throughput dashboard shows OSTs unevenly utilized; the file system is not saturated, but client perspective is.
**Prevention:** Set `lfs setstripe` with a higher stripe count for files larger than a few hundred MB. For very large files like aligned BAMs, stripe across all OSTs.

### Spot reclamation interrupts long alignment jobs

A subset of workers vanish after 2-minute interruption notices. Look like crashes, but Batch retries them. Different from metadata stall; presents as variable completion times instead of all workers stalled.
**Prevention:** Use SPOT_CAPACITY_OPTIMIZED allocation strategy, diversify instance types, checkpoint partial output to FSx so retries do not start from scratch.

### Data Repository Association lag from S3 to FSx

Workers cannot find files in FSx because the DRA has not yet imported them. Symptom is `stat` returning ENOENT, not blocking on open.
**Prevention:** Use FSx data-repository tasks (DRT) to pre-import S3 objects before launching workers. Or run workers in a Step Function that waits on the DRT.

### Many small writes to the same directory

Same metadata pressure phenomenon, but on the output side. Workers write per-sample BAM files into one directory; create() syscalls block. Different cause (writes vs reads), same fix (shard directories or write to S3 directly).
**Prevention:** Shard the output directory keyed on a hash. Or use S3 directly as the output destination with multipart uploads.

## SOP Best Practices

- Treat FSx for Lustre metadata IOPS as a load-bearing capacity dimension separate from throughput. Provision based on the worst-case open() rate from your fleet, not just storage size. The AUTOMATIC default is correct only for typical workloads; HPC fan-out is rarely typical.
- Avoid concentrating opens in a single directory at HPC scale. If 1,000 workers all read the same set of files, replicate the files across many directories or pre-copy to instance-local storage. The same applies to writes: shard output paths.
- Pre-stage hot small files to instance NVMe. References, dictionaries, and config files that every worker needs are read-only and shared; copy them once at worker startup from S3 (parallel fan-out is cheap) and then read from local. Reserves FSx for the actual sample data path.
- Alarm on metadata utilization, not just throughput. CloudWatch metric MetadataOperations divided by configured Iops gives a utilization percentage. 70% should warn, 90% should page. Throughput dashboards alone hide metadata bottlenecks completely.

## Learning Objectives

1. **Lustre architecture mental model**: Articulate MDS, OSTs, clients, and the two distinct performance dimensions (metadata IOPS vs data throughput).
2. **Metadata vs throughput diagnosis**: Read CloudWatch FSx metrics correctly; recognize when "throughput is fine" hides a metadata bottleneck.
3. **Mode and IOPS tuning**: Switch between AUTOMATIC and USER_PROVISIONED; pick metadata IOPS for HPC fan-out.
4. **Architectural mitigations**: Shard directories, pre-stage to NVMe, and treat reference files as a separable hot path.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design for New Solutions
- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: Design High-Performing Architectures
