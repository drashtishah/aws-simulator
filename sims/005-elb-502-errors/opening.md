4:48 PM Friday. UrbanFleet's dispatch dashboard has gone white, replaced by a single HTTP 502 across every browser tab in the ops room.

PagerDuty fired two minutes ago: `urbanfleet-prod` ALB, 100% error rate, zero healthy targets in `urbanfleet-dispatch-tg`. The mobile app is dead. 1,200 drivers are stopped mid-route with no instructions and no navigation updates.

Your phone buzzes: VP of Ops in Slack. "Retail partners are calling. Packages are stacking up at three distribution centers. We have a two-hour delivery window that closes at 7 PM."

All four EC2 instances show registered in the target group. CloudWatch shows the ALB is up and accepting connections. Auto Scaling is active.

Where do you start?
