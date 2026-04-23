Ironfoam Beverage, Tuesday 07:40 Central. The Security Operations analyst forwards a CloudTrail alert to the Platform lead with a single line: "acme-bev-bottles listed every customer folder last night".

The alert fired because a midnight scheduled job noticed that the count of s3:ListBucket calls under the ironfoam-invoices-shared bucket spiked 40x overnight, all from the same Transfer Family role session. The prefixes in the calls span 43 different customer folders.

One SFTP user. Forty-three other customers. 1,187 CSV files read.

The Transfer Family configuration for that user was set up three weeks ago when Acme Beverage Bottles was onboarded, and the template was copied from the 270 other partner users already live on the platform.

Where do you start?
