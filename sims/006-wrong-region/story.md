---
tags:
  - type/simulation
  - service/lambda
  - service/cloudwatch
  - service/iam
  - difficulty/starter
  - category/operations
---

# A Function in the Wrong Room

## Opening

The deploy finished at 14:12 UTC. The pipeline said everything was fine. Green checkmark, clean logs, no warnings. You closed the terminal tab and went to get water.

Calendine is a small company. Eight engineers building a scheduling tool for independent consultants. The kind of product where a single API endpoint handles booking creation, and if that endpoint goes down, the consultants' clients see a blank page where the calendar should be. There is a demo for a potential enterprise customer at 14:45 UTC. The sales engineer has been preparing for it since Monday.

You came back to your desk at 14:18 UTC and opened the API endpoint in a browser to do a quick smoke test. The response was a JSON object with one field: `message: "Internal server error"`. You opened CloudWatch. The API Gateway logs showed `ResourceNotFoundException: Function not found`. The function you deployed twenty minutes ago. The function that the pipeline confirmed was successful.

The ARN in the error pointed to `us-east-1`. You had no reason to doubt it. The API Gateway was in `us-east-1`. Everything was supposed to be in `us-east-1`. You opened the Lambda console in `us-east-1` and searched for `calendine-booking-api`. Nothing. The function did not exist.

## Resolution

The function was in `us-west-2`. It had been there since the deploy at 14:12 UTC, running normally, waiting for invocations that would never come. The CI/CD pipeline environment had `AWS_DEFAULT_REGION` set to `us-west-2`. Someone on the team had changed it the previous week while testing a disaster recovery configuration. They had not changed it back.

The fix was to redeploy the function to `us-east-1`. This meant either overriding the region in the deploy command with `--region us-east-1` or correcting the `AWS_DEFAULT_REGION` variable in the pipeline configuration. The team chose to do both -- fix the environment variable and add an explicit `--region` flag to the deploy script so it would never depend on the ambient configuration again.

The demo happened at 14:52 UTC, seven minutes late. The sales engineer made a small joke about technical difficulties. The customer did not seem to mind. The function in `us-west-2` was deleted the following morning. Nobody had noticed it was there.
