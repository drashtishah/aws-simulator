Meridian Health. 6:22 AM, Monday. You are halfway through your first cup of coffee when the Slack security channel fires.

A security researcher sent a responsible disclosure email twenty minutes ago. Subject line: "Patient documents publicly accessible." Attached screenshot shows a patient intake form, name, date of birth, and insurance ID fully visible, downloaded from a direct S3 URL with no credentials.

Your compliance officer, Priya, is already online. She types: "HIPAA breach notification clock starts at first exposure. Every hour matters."

The bucket in question is `meridian-patient-documents`. You confirm it yourself: copy the S3 URL into an incognito window, no AWS credentials, no sign-in. The PDF downloads immediately.

340 medical practices. 12,000 intake forms per day. CloudTrail is running. Where do you start?
