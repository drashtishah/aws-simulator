Hollowfield Labs, Tuesday 09:12. Every engineer who tries to reach admin.hollowfield.internal this morning gets the same screen: a plain black page with the text "Access denied. Contact your administrator." The VP of Research cannot approve a quarterly cluster budget. The Billing Operations lead cannot push the March feature-flag rollover.

The admin portal is up. Its ALB shows all targets healthy. Its internal services respond to health checks. Nothing in the app itself has changed.

The Verified Access endpoint in front of it was modified last night as part of a larger identity migration from Amazon Cognito to Okta.

Where do you start?
