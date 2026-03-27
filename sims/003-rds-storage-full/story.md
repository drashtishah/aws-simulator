---
tags:
  - type/simulation
  - service/rds
  - service/cloudwatch
  - service/ec2
  - difficulty/foundational
  - category/data
---

# The CropSync Harvest Crisis: Database Full

## Opening

company: CropSync
industry: agritech, Series A startup, 18 engineers
product: precision agriculture software -- collects soil moisture data from IoT sensors, cross-references with weather forecasts, generates irrigation schedules
scale: 4,700 farms across 12 states, 280,000 data points per day from field sensors, 1,200 concurrent users during peak hours
time: 2:17 PM, Thursday, late September -- peak harvest season in the midwest
scene: monitoring dashboard lights up
alert: CropSync API returning 500 errors on every write operation -- farmers cannot save irrigation schedules, log field observations, or update harvest tracking data
stakes: farm manager in Iowa cannot log irrigation schedule, weather service forecasting first rain in three weeks for tonight, needs to adjust center-pivot systems before water arrives, manual configuration takes four hours they do not have
early_signals:
  - support line ringing with farmers unable to write data
  - API servers running and connecting to database, but every INSERT and UPDATE query failing
  - SELECT queries still work
  - application has not been deployed in three days
investigation_starting_point: API servers are healthy and connected to the database. Write operations fail, read operations succeed. No recent application deploy. Something changed at the database level.

## Resolution

root_cause: RDS MySQL instance `cropsync-prod-db` (db.t3.medium, 20GB gp3 storage, provisioned six months earlier) completely exhausted its allocated storage
mechanism: three factors converged -- (1) rapid growth during growing season, active farm count tripled from 1,500 to 4,700 in four months, IoT sensor data table growing by 800MB per week; (2) MySQL binary logging enabled for point-in-time recovery, binary logs accumulated 3.2GB over retention period; (3) developer added verbose query logging two weeks earlier for debugging a performance issue and never turned it off, adding 1.8GB of slow query logs. When FreeStorageSpace hit zero, MySQL could not write to any table or create temporary files. All INSERT, UPDATE, DELETE operations failed with "The table is full" errors. SELECT queries continued working (read-only access).
fix: increase allocated storage from 20GB to 50GB via AWS console (applied immediately, no downtime required), purge accumulated binary logs, disable verbose query logging. Long-term: enable RDS storage auto-scaling with 100GB maximum, set CloudWatch alarm on FreeStorageSpace with 2GB threshold.
contributing_factors:
  - no CloudWatch alarm on FreeStorageSpace to provide early warning
  - storage auto-scaling not enabled on the instance
  - verbose slow query logging left on in production for two weeks after debugging concluded
