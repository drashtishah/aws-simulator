Larkspur Health, Thursday 14:22 Eastern. You are the security engineer on call.

A compliance team member opens a ticket: "Can't access larkspur-phi-archive from the Console. Getting AccessDenied on everything. This started after the bucket policy update this morning."

You try it yourself. Same result. Your IAM role has AdministratorAccess. The bucket shows no public access block change, no KMS key rotation, no recent CloudFormation drift.

You wrote the bucket policy at 09:47 this morning to enforce VPC-only access. The application servers in the private subnet are still reading and writing files without issue.

Where do you start?
