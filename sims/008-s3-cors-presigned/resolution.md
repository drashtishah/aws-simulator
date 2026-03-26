---
tags:
  - type/resolution
  - service/s3
  - service/cloudfront
  - service/api-gateway
  - difficulty/associate
  - category/operations
---

# Resolution: The Upload That Worked Everywhere Else

## Root Cause

The S3 bucket `pollen-docs-prod` had no CORS configuration. When the browser at `https://app.pollen.io` attempted a cross-origin PUT request to `https://d-EDFDVBD6EXAMPLE.cloudfront.net` (backed by the S3 bucket), the browser first sent an OPTIONS preflight request. S3 returned a 403 with no `Access-Control-Allow-Origin` header. The browser blocked the subsequent PUT request before it was sent.

Additionally, the CloudFront distribution `d-EDFDVBD6EXAMPLE` used the default `CachingOptimized` policy, which does not forward the `Origin`, `Access-Control-Request-Headers`, or `Access-Control-Request-Method` headers to the origin. This meant CloudFront would cache responses without CORS headers and serve them to browser clients, even after CORS was configured on S3.

Non-browser clients (curl, Postman, backend scripts) are not subject to the same-origin policy and do not send preflight requests. This is why the upload worked from every client except the browser.

## Timeline

| Time | Event |
|---|---|
| 14:15 UTC | Rina reports in #frontend that browser uploads are failing. Presigned URL works in Postman. |
| 14:20 UTC | Rina begins investigating IAM policy attached to the presigned URL generation role. |
| 14:45 UTC | Rina checks presigned URL expiry (3600s). Regenerates URL. Same failure. |
| 15:00 UTC | Rina re-reads IAM policy JSON a second time. Permissions are correct. |
| 15:30 UTC | Rina reads IAM policy a third time. Checks S3 bucket policy. No issues found. |
| 16:10 UTC | Tomas joins investigation. Checks API Gateway CloudWatch logs -- presigned URL generation succeeding. |
| 16:20 UTC | Tomas checks S3 access logs. Backend test uploads succeeding. Asks Rina to check browser console. |
| 16:22 UTC | Rina opens browser developer tools. CORS error visible in console and Network tab. |
| 16:30 UTC | Team identifies missing CORS configuration on S3 bucket via `aws s3api get-bucket-cors`. |
| 16:40 UTC | CORS configuration added to `pollen-docs-prod` bucket. |
| 16:42 UTC | Browser upload still fails. Team investigates CloudFront. |
| 16:48 UTC | CloudFront origin request policy found to be missing Origin header forwarding. |
| 16:52 UTC | Origin request policy updated. CloudFront cache invalidation created for `/*`. |
| 16:55 UTC | Browser upload succeeds. Incident resolved. |

## Correct Remediation

1. **Tell S3 which websites are allowed to make requests**: CORS (Cross-Origin Resource Sharing) is a browser security feature. The browser refuses to upload to a different domain unless that domain explicitly says "I accept requests from your website." You configure this by adding CORS rules to the S3 bucket. The rules below say: "Allow the website at https://app.pollen.io to make GET, PUT, POST, and HEAD requests, with any headers, and let the browser read the ETag and request ID from the response."

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://app.pollen.io"],
      "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "x-amz-request-id"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

Apply with: `aws s3api put-bucket-cors --bucket pollen-docs-prod --cors-configuration file://cors.json`

2. **Tell CloudFront to forward the browser's CORS headers to S3**: CloudFront (a content delivery network that speeds up requests by caching responses at locations near users) sits between the browser and S3. By default, it strips the `Origin` header from requests before passing them to S3. Without this header, S3 does not know the request came from a browser and does not include CORS permission headers in the response. Attach the AWS-managed `CORS-S3Origin` origin request policy (ID: `88a5eaf4-2fd4-4709-b370-b4c650ea3fcf`), which tells CloudFront to forward:
   - `Origin` -- which website is making the request
   - `Access-Control-Request-Headers` -- which headers the browser wants to send
   - `Access-Control-Request-Method` -- which HTTP method the browser wants to use

3. **Clear CloudFront's cached responses**: CloudFront may have already cached responses that lack CORS headers (from earlier non-browser requests). Those stale cached responses would keep causing failures. Clear them with a cache invalidation:

```
aws cloudfront create-invalidation --distribution-id EDFDVBD6EXAMPLE --paths "/*"
```

4. **Verify the fix**: Upload a file from the browser at `https://app.pollen.io`. Check the browser console for any remaining CORS errors. Confirm the file appears in the S3 bucket.

5. **Prevent this in the future**: Add a checklist item to the team's S3 bucket creation runbook: "If browser clients will access this bucket directly, configure CORS rules and the CloudFront origin request policy before the feature ships."

## Key Concepts

### What Is a Preflight Request and Why Does the Browser Send One?

When your web page tries to upload a file to a different domain (like S3), the browser does not just send the file. First, it sends a separate "preflight" request using the HTTP OPTIONS method. This preflight is the browser asking S3: "Will you accept a PUT request from this website, with these headers?" If S3 does not respond with the right permission headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`), the browser blocks the upload entirely. The actual file is never sent.

Not every request triggers a preflight. Simple requests like basic GET or POST with standard content types skip it. But a PUT request (which is what a file upload uses) always triggers a preflight. This is why the upload fails silently in the browser -- the preflight is rejected before the upload even starts.

### Presigned URLs and CORS Are Two Separate Things

A presigned URL solves the authentication problem. It bakes temporary AWS credentials, an expiration time, and a digital signature into the URL itself, so anyone with the URL can perform a specific S3 operation without having their own AWS account. But a presigned URL does not solve the CORS problem. CORS is checked by the browser before the request even reaches S3. The browser does not care about the signature in the URL -- it only cares whether S3 said "yes, I accept requests from your website."

### How CloudFront Can Break CORS Even When S3 Is Configured Correctly

CloudFront is a content delivery network -- it caches responses at locations close to users to make things faster. By default, CloudFront does not forward the `Origin` header from the browser to S3. Here is what happens:

1. A non-browser client (like a health check or curl) makes a request to CloudFront. There is no `Origin` header. S3 returns a response without CORS headers. CloudFront caches this response.
2. A browser request arrives at CloudFront with an `Origin` header. CloudFront sees a cached response for the same URL and serves it -- but that cached response has no CORS headers.
3. The browser sees no CORS headers and blocks the request.

The fix is the `CORS-S3Origin` origin request policy, which tells CloudFront to forward the `Origin` header to S3. This way, CloudFront caches separate responses for requests with and without the `Origin` header.

### Why curl and Postman Work But the Browser Does Not

CORS is enforced entirely by the browser. It is not a server-side access control. When curl sends a PUT request, it does not check for permission headers in the response. It does not send a preflight OPTIONS request. The concept of "same-origin policy" (blocking requests to different domains) simply does not exist outside the browser. This is why "it works in curl but not the browser" is the classic symptom of a CORS problem.

## Other Ways This Could Break

### CORS rules exist but your website is not on the allowed list

The S3 bucket has CORS rules, but the list of allowed websites (AllowedOrigins) does not include the application's domain (e.g., `https://app.pollen.io`). S3 returns a specific error: "This CORS request is not allowed." The fix is narrower than this sim -- you just need to add the missing domain to the AllowedOrigins list rather than creating the entire CORS configuration from scratch. This is easy to miss when a staging domain works but the production domain was never added.

### CloudFront serves a cached response that is missing CORS headers

CORS is correctly configured on S3. Direct browser requests to S3 work fine. But requests through CloudFront fail intermittently. This happens because CloudFront cached a response from a non-browser client (like a health check or curl request) that had no CORS headers. When a browser request arrives next, CloudFront serves that cached response -- which is missing the headers the browser needs. The fix is to attach an origin request policy that forwards the Origin header (so CloudFront caches browser and non-browser responses separately) and to clear the cache.

### The presigned URL signature does not match because the browser added unexpected headers

The browser automatically adds a Content-Type header with a value different from what was expected when the presigned URL was generated. S3 returns a "SignatureDoesNotMatch" error instead of a CORS error. The symptom looks similar -- the upload fails in the browser but works in curl -- but the root cause is in how the presigned URL was created, not in CORS. The fix is to include the Content-Type header when generating the presigned URL so the signature accounts for it.

### The bucket's access policy blocks the preflight check before CORS rules are evaluated

The bucket has CORS rules, but a separate access control document (called a bucket policy) explicitly denies all HTTP methods except GET and PUT. The browser's preflight check uses the OPTIONS method, which the bucket policy blocks. S3 never gets to evaluate the CORS rules because the request is denied first. The fix is to make sure the bucket policy does not block OPTIONS when CORS is needed.

## SOP Best Practices

1. Whenever a browser will upload files directly to S3, set up CORS rules on the bucket before the feature goes live. Test with a simulated preflight check (`curl -X OPTIONS`) to verify the rules are working before users see the feature.
2. When CloudFront (the content delivery network) sits between the browser and S3, attach the AWS-managed CORS-S3Origin origin request policy (ID: `88a5eaf4-2fd4-4709-b370-b4c650ea3fcf`). This tells CloudFront to forward the browser headers that S3 needs to respond with CORS permissions. Without this policy, CloudFront strips those headers and CORS breaks.
3. After changing CORS rules or CloudFront policies, always clear the CloudFront cache (create an invalidation for `/*`). Stale cached responses without CORS headers will keep causing failures for browsers until they expire on their own.
4. Add CORS verification to the team's deployment checklist for any feature where a browser talks directly to S3 -- including presigned URL uploads and static website hosting.

## Learning Objectives

1. **CORS mechanics**: Understand that CORS is a browser-enforced security mechanism, not a server-side access control. Non-browser clients are unaffected.
2. **S3 CORS configuration**: Know that S3 buckets require explicit CORS rules to respond with `Access-Control-Allow-*` headers to cross-origin requests.
3. **CloudFront header forwarding**: Understand that CloudFront must forward `Origin` and CORS-related headers to the origin for CORS responses to vary correctly.
4. **Presigned URL scope**: Recognize that presigned URLs handle authentication/authorization but are completely separate from CORS compliance.
5. **Debugging approach**: When a request works from non-browser clients but fails in the browser, check the browser console for CORS errors before investigating IAM or URL validity.

## Related

- [[exam-topics#DVA-C02 -- Developer Associate]] -- Domain 1: Development
- [[exam-topics#SAA-C03 -- Solutions Architect Associate]] -- Domain 3: High-Performing Architectures
- [[catalog]] -- s3, cloudfront, api-gateway service entries
