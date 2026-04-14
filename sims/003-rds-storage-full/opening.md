CropSync, 2:17 PM. Peak harvest season, midwest.

The monitoring dashboard is lit: every POST to `api.cropsync.io` returning HTTP 500. Farmers cannot save irrigation schedules, log field observations, or update harvest records. SELECT queries are returning fine. Writes are failing across the board.

Your support queue shows 34 open tickets in the last 22 minutes. A farm manager in Iowa left a voicemail: rain is forecast tonight for the first time in three weeks, center-pivot adjustments need to be logged before 6 PM, and she cannot save anything.

The API servers, `cropsync-api-01` and `cropsync-api-02`, show green on the ALB health checks. The database, `cropsync-prod-db`, appears reachable.

Where do you start?
