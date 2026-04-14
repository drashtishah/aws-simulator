Fenwick Systems, Portland. Wednesday, 9:14 AM.

The CI/CD pipeline on `fenwick-ci-01` has returned AccessDenied on every AWS API call since 4 PM yesterday: S3 upload, Secrets Manager fetch, Lambda update, all blocked. Staging is frozen on last week's build.

Priya from product stopped by ten minutes ago to ask why her demo environment still shows the old invoice layout. She has a customer call at noon.

The instance profile is attached. The IAM role policies check out. The deploy script has not changed since February. The instance itself is healthy.

Where do you start?
