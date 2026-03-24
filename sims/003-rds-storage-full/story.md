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

It is 2:17 PM on a Thursday in late September -- peak harvest season in the midwest. Your monitoring dashboard lights up: the CropSync API is returning 500 errors on every write operation. Farmers are reporting that they cannot save irrigation schedules, log field observations, or update harvest tracking data.

CropSync is a Series A agritech startup that provides precision agriculture software to 4,700 farms across 12 states. The platform collects soil moisture data from IoT sensors, cross-references it with weather forecasts, and generates irrigation schedules that farmers rely on to manage water usage. During harvest season, the platform processes 280,000 data points per day from field sensors and serves 1,200 concurrent users during peak hours.

The support line is ringing. A farm manager in Iowa says he cannot log his irrigation schedule for the afternoon -- the weather service is forecasting the first rain in three weeks for tonight, and he needs to adjust his center-pivot systems before the water arrives. If he cannot update the schedule in CropSync, his team will have to configure each pivot manually, which takes four hours they do not have.

You pull up the application logs. The API servers are running, they are connecting to the database, but every INSERT and UPDATE query is failing. SELECT queries still work. The application has not been deployed in three days. Something changed at the database level.

## Resolution

The investigation found that the RDS MySQL instance `cropsync-prod-db` had completely exhausted its 20GB of allocated storage. The instance was provisioned six months earlier with 20GB of gp3 storage, which seemed generous at the time for a startup's dataset. But three factors converged to fill the disk.

First, CropSync had experienced rapid growth during the growing season -- their active farm count tripled from 1,500 to 4,700 in four months, and the IoT sensor data table was growing by 800MB per week. Second, MySQL binary logging was enabled for point-in-time recovery, and binary logs accumulated 3.2GB over the retention period. Third, a developer had added a verbose query logging configuration two weeks earlier for debugging a performance issue and never turned it off, adding another 1.8GB of slow query logs.

When FreeStorageSpace hit zero, MySQL could not write to any table or create temporary files for query execution. All INSERT, UPDATE, and DELETE operations failed with "The table is full" errors. SELECT queries continued to work because they only require read access.

The immediate fix was to increase the allocated storage from 20GB to 50GB through the AWS console -- RDS storage modifications can be applied immediately and do not require downtime. The team also purged the accumulated binary logs and disabled the verbose query logging. As a long-term fix, they enabled RDS storage auto-scaling with a maximum of 100GB and set a CloudWatch alarm on FreeStorageSpace with a threshold of 2GB.
