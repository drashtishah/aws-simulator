---
tags:
  - type/resolution
  - service/memorydb
  - service/ec2
  - service/iam
  - service/cloudwatch
  - difficulty/professional
  - category/reliability
---

# Resolution: The Key the Cache Would Not Drop

## Root Cause

The Redis ACL rule attached to the `drifter-app` user on `drifter-memorydb-cluster` is:

```
on ~* +@read +@write +@connect -@dangerous
```

The trailing `-@dangerous` removes every command in Redis's `@dangerous` category. That category includes `FLUSHDB`, `FLUSHALL`, `SHUTDOWN`, `CONFIG`, `KEYS`, and `DEBUG`.

The nightly `cleanup-scratch` ECS scheduled task authenticates as `drifter-app` (every Drifter workload does), runs `SELECT 5; FLUSHDB` to clear the pre-aggregation scratch database, and receives:

```
(error) NOPERM this user has no permissions to run the 'flushdb' command
```

The task retries three times, fails, exits non-zero, and writes a one-line failure to CloudWatch Logs. Nothing else happens: no alarm, no PagerDuty, no Slack notification.

Over six days, scratch keys accumulate at ~300 MB/day until they consume 2.1 GB of the 3.2 GB shard capacity. MemoryDB's default `maxmemory-policy` of `allkeys-lru` then evicts real session-state keys to make room, which surfaces to end users as "invalid session token" errors on their next API call.

## Timeline

| Time | Event |
|---|---|
| Sat -7 22:00 | Migration cutover begins: drifter-memorydb-cluster created, data replicated from ElastiCache |
| Sat -7 23:48 | Cutover completes, application traffic switched to MemoryDB |
| Sun -6 02:00 | First cleanup-scratch run under MemoryDB; FLUSHDB returns NOPERM, task exits non-zero |
| Mon -5 02:00 | Second cleanup failure; scratch db at 320 MB |
| ...          | Pattern repeats nightly; scratch db grows ~300 MB/day |
| Sun -1 02:00 | Seventh cleanup failure; scratch db at 2.1 GB, cluster memory at 91 percent |
| Sun -1 13:22 | First eviction observed; Evictions metric nonzero |
| Mon -0 09:40 | First customer support ticket ("invalid session") |
| Mon 10:14 | 22 tickets open, two enterprise accounts escalated; platform oncall starts investigation |
| Mon 10:38 | Cleanup task logs examined; NOPERM error surfaced |
| Mon 10:55 | ACL rule read; `-@dangerous` exclusion identified |
| Mon 11:02 | drifter-cleanup user created with minimal rules; ECS task updated |
| Mon 11:05 | Manual cleanup run succeeds; memory drops to 62 percent |
| Mon 11:30 | Evictions return to zero; session-login complaints stop |

## Correct Remediation

1. **Start at the user-visible symptom.** Players cannot stay logged in. The session-state store is MemoryDB. Walk backward from that to memory pressure in the cluster.
2. **Check cluster metrics.** `DatabaseMemoryUsagePercentage` and `Evictions` under the `AWS/MemoryDB` namespace in CloudWatch. A usage above 90 with nonzero evictions means the cache is under pressure and dropping real keys.
3. **Find what is using the memory.** Use `DBSIZE` per database (MemoryDB supports multiple logical databases) or the MemoryDB console's Metrics > Keys tab. In this sim, `db 5` has grown from ~50 MB baseline to over 2 GB.
4. **Identify what writes to that database and what was supposed to clean it up.** `db 5` is the scratch space for pre-aggregation. A nightly ECS scheduled task `cleanup-scratch` is the janitor.
5. **Read the cleanup task's logs.** You will find the exact error: `NOPERM this user has no permissions to run the 'flushdb' command`. `NOPERM` is MemoryDB's way of saying "authenticated, but the ACL rule blocked this specific command".
6. **Read the ACL rules.** Run `aws memorydb describe-acls --name drifter-memorydb-acl` or open the ACL in the MemoryDB console. Find the rule for `drifter-app`: `on ~* +@read +@write +@connect -@dangerous`. `-@dangerous` is why FLUSHDB is refused.
7. **Choose the minimally invasive fix.** Three options, most to least preferred:
   - **Best: dedicated user.** Create a `drifter-cleanup` user with `on ~* +ping +select +flushdb` (plus `+flushall` if ever needed). Add to the cluster's ACL. Update the cleanup-scratch ECS task to authenticate as this new user. Keeps `drifter-app` as tight as it was.
   - **Quick: reopen FLUSHDB on the shared user.** Change the rule to `on ~* +@read +@write +@connect -@dangerous +flushdb`. Redis processes ACL rules left to right, so `+flushdb` after `-@dangerous` re-adds just that command. Simple but now every workload authenticating as drifter-app can FLUSHDB.
   - **Rewrite the cleanup.** Replace `FLUSHDB` with `SCAN 0 MATCH scratch:* COUNT 1000` + `UNLINK` batches. Slower, requires code changes, but avoids touching the ACL.
8. **Ship option B for this sim.** Create the user via `memorydb create-user`, attach it to the ACL via `memorydb update-acl`, store its auth token in Secrets Manager, and update the ECS task definition to use the new secret. Test in staging; deploy; manually trigger one cleanup to validate.
9. **Verify recovery.** `DatabaseMemoryUsagePercentage` should drop within seconds of the successful FLUSHDB. Watch `Evictions` return to zero over the next 10–20 minutes as traffic repopulates what was lost.
10. **Add the missing alarms.**
    - `FailedInvocations` on the `cleanup-scratch` EventBridge schedule (or ECS task non-zero exit, depending on how scheduled tasks are wired).
    - `DatabaseMemoryUsagePercentage` over 80 for 15 minutes.
    - `Evictions` nonzero for 10 minutes.

## Key Concepts

### MemoryDB vs ElastiCache

Amazon MemoryDB for Redis and Amazon ElastiCache for Redis look similar from a client's perspective (both speak the Redis wire protocol), but they are different services with different defaults.

| Property | ElastiCache for Redis | MemoryDB for Redis |
|---|---|---|
| Intended use | In-memory cache | Primary database |
| Durability | Snapshots; data lost on node failure | Multi-AZ transaction log; data survives node failure |
| Default auth | Open-access (no auth) or Redis AUTH | ACL always enabled; default user is 'off' |
| Multi-AZ write consistency | None | Strongly consistent across AZ writes |
| Typical cost | Lower | Higher (durability is not free) |

The critical migration gotcha is authentication. ElastiCache open-access mode gave any client with network reachability the right to run any command. MemoryDB has ACLs always enabled, and the migration wizard auto-generates a user and ACL rule for you. That auto-generated rule is opinionated and likely tighter than what open-access ElastiCache allowed.

### Redis ACL Rule Grammar

A Redis 6+ ACL rule is a compact string of space-separated tokens, evaluated left to right. Common tokens:

- `on` / `off` — enable or disable the user
- `~<pattern>` — add a key pattern the user can touch (e.g. `~session:*`, `~*` for all keys)
- `&<pattern>` — add a pub/sub channel pattern
- `+<command>` — permit a specific command (e.g. `+get`, `+flushdb`)
- `-<command>` — forbid a specific command
- `+@<category>` — permit a command category (e.g. `+@read`, `+@write`)
- `-@<category>` — forbid a command category
- `>password` — set a password; `#hash` sets an SHA-256 hashed password; `nopass` allows passwordless
- `allcommands` — shorthand for `+@all`
- `allkeys` — shorthand for `~*`

Rules are applied in order, so `+@all -flushdb` means "everything except FLUSHDB", while `-@all +get +set` means "nothing except GET and SET". `-@dangerous +flushdb` means "nothing in the dangerous category, except FLUSHDB which we added back".

### Command Categories

Redis organizes commands into categories so that ACLs can grant or deny broad sets without enumerating each command:

- `@read`, `@write`, `@slow`, `@fast`
- `@keyspace`, `@string`, `@list`, `@set`, `@hash`, `@sortedset`, `@stream`
- `@connection`, `@transaction`, `@scripting`, `@pubsub`
- `@admin`, `@dangerous`

The `@dangerous` category covers irrecoverable or powerful commands: `FLUSHALL`, `FLUSHDB`, `KEYS`, `CONFIG`, `DEBUG`, `SHUTDOWN`, `MIGRATE`, `RESTORE`. A MemoryDB wizard-generated user almost always excludes `@dangerous`, which is the right default for an application user but the wrong default for a cleanup or admin user.

### Why a Shared User Is the Wrong Pattern

Every Drifter workload authenticates as `drifter-app`. That means the ACL rule for `drifter-app` must be the union of what every workload needs. The most restrictive permission gates are determined by the most permissive workload; the least restrictive gates are determined by the least trustworthy workload. Neither is good.

Per-workload users fix this. `drifter-session-svc-user` needs exactly `on ~session:* +@read +@write +@connect -@dangerous`. `drifter-cleanup-user` needs exactly `on ~* +select +flushdb +ping`. `drifter-admin-user` needs exactly what an operator running one-off commands needs, and is used only from a locked-down bastion. The ACL surface for a compromised service is now the surface that service actually uses, not the union of everything.

## Other Ways This Could Break

### Correct command, wrong key pattern
The rule is `on ~session:* +@all`. FLUSHDB is technically in `+@all`, but it operates on the whole database, and ACL evaluates it against the key pattern. The user's pattern is `~session:*` not `~*`, so FLUSHDB is refused. Symptom is NOPERM citing the key pattern rather than the command.
**Prevention:** For users that perform database-wide administrative commands, use `~*` and restrict via commands instead of patterns.

### Cleanup task connects as the default user, which MemoryDB disables
In MemoryDB, the `default` user is `off`. A legacy client that does not pass credentials fails at authentication with NOAUTH or WRONGPASS, before any command is attempted.
**Prevention:** Explicitly configure credentials in every MemoryDB client. Never rely on default-user behavior.

### IAM authentication is enabled, and the task role lacks `memorydb:Connect`
With IAM auth enabled, MemoryDB requires both an IAM policy granting `memorydb:Connect` on the cluster AND a matching Redis ACL rule. If the IAM side is missing, the client fails at connect with a NOAUTH, not a NOPERM on a specific command.
**Prevention:** When wiring IAM auth, test every workload that connects, including scheduled ECS tasks, batch jobs, and interactive sessions from the bastion.

## SOP Best Practices

- Create one MemoryDB user per operational role, not a shared user across workloads. The ACL for each role should describe exactly what that role does.
- Review every wizard-generated ACL rule before accepting it. The defaults are designed for a generic application, not for an admin or cleanup role.
- Alarm on `DatabaseMemoryUsagePercentage` sustained over 80 percent and on `Evictions` nonzero. Eviction of real data manifests upstream as customer errors long before it looks like a cache problem.
- Alarm on scheduled task exit codes. A green "ran" status with a non-zero exit is the classic silent failure.

## Learning Objectives

1. **MemoryDB vs ElastiCache:** Understand the durability model, the always-on ACL model, and why migration requires revisiting authentication.
2. **Redis ACL rule grammar:** Read and write rules including categories (`@dangerous`, `@read`) and per-command overrides.
3. **Least privilege for shared stores:** Understand why a shared user is an anti-pattern and how per-role users solve it.
4. **Memory pressure failure modes:** Recognize that silent cleanup failures manifest upstream as eviction and lost state.
5. **Scheduled-task observability:** Know to alarm on scheduled task exit codes, not just on service-level metrics.

## Related

- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: Design High-Performing Architectures
- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 2: Security
- [[learning/catalog.csv]] -- Player service catalog and progress
