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

1. **Add CORS configuration to S3 bucket**: Apply a CORS configuration to `pollen-docs-prod` that allows the application origin, the required HTTP methods, and necessary headers.

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

2. **Update CloudFront origin request policy**: Change the cache behavior to use an origin request policy that forwards CORS-related headers to S3. Use the AWS-managed `CORS-S3Origin` policy (ID: `88a5eaf4-2fd4-4709-b370-b4c650ea3fcf`) or create a custom policy that forwards:
   - `Origin`
   - `Access-Control-Request-Headers`
   - `Access-Control-Request-Method`

3. **Invalidate CloudFront cache**: Create an invalidation for `/*` to clear any cached responses that lack CORS headers.

```
aws cloudfront create-invalidation --distribution-id EDFDVBD6EXAMPLE --paths "/*"
```

4. **Verification**: Upload a file from the browser at `https://app.pollen.io`. Confirm no CORS errors in the browser console. Confirm the file appears in the S3 bucket.

5. **Prevention**: Add a checklist item to the team's S3 bucket creation runbook: "If browser clients will access this bucket directly, configure CORS before the feature ships."

## Key Concepts

### CORS Preflight Requests

When a browser makes a cross-origin request that is not "simple" (e.g., a PUT request, or a request with custom headers), it first sends an OPTIONS request called a preflight. The preflight asks the server: "Will you accept a PUT from this origin with these headers?" If the server does not respond with the correct `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` headers, the browser blocks the actual request. The actual PUT is never sent.

A "simple" request is limited to GET, HEAD, or POST with standard content types. A PUT with a presigned URL is not simple. It always triggers a preflight.

### Presigned URLs and CORS

Presigned URLs solve the authentication problem. They encode AWS credentials, expiry, and a signature into the URL so that an unauthenticated client can perform a specific S3 operation. But presigned URLs do not solve the CORS problem. CORS is enforced by the browser before the request reaches S3. The presigned URL signature is irrelevant to the preflight check.

### CloudFront Origin Request Policies

CloudFront can cache responses based on various request attributes. By default, the `CachingOptimized` policy does not forward the `Origin` header to the origin. This means:

- A request without an `Origin` header (e.g., from curl) hits S3, gets a response without CORS headers, and CloudFront caches it.
- A subsequent request with an `Origin` header (from a browser) gets the cached response -- which has no CORS headers.
- The browser blocks the request.

The `CORS-S3Origin` managed origin request policy forwards the three headers needed for CORS: `Origin`, `Access-Control-Request-Headers`, and `Access-Control-Request-Method`. This ensures CloudFront caches different responses for different origins.

### Why Non-Browser Clients Skip CORS

CORS is a browser security feature. It is not enforced by S3 or any server. When curl sends a PUT request, it does not check for `Access-Control-Allow-Origin` in the response. It does not send a preflight OPTIONS request. The same-origin policy does not exist outside the browser. This is why "it works in curl but not the browser" is the classic symptom of a CORS misconfiguration.

## Other Ways This Could Break

### CORS configured but AllowedOrigins does not match

The S3 bucket has a CORS configuration, but the AllowedOrigins list does not include the application domain (e.g., `https://app.pollen.io`). S3 returns a 403 with "This CORS request is not allowed" instead of "CORS is not enabled for this bucket." The fix is narrower: update AllowedOrigins to include the correct origin. This is easy to miss when a staging domain works but the production domain was never added.

### CloudFront caches a non-CORS response

CORS is correctly configured on S3. Direct requests to S3 from the browser succeed. But requests through CloudFront fail intermittently. This happens because CloudFront cached a response to a request that did not include an Origin header (e.g., a curl request or a health check). That cached response has no CORS headers. When a browser request arrives, CloudFront serves the cached response, and the browser blocks it. The fix is to attach an origin request policy that forwards the Origin header and to invalidate the cache.

### Presigned URL signature mismatch from extra headers

The browser adds a Content-Type header with a value different from what was used when the presigned URL was generated. S3 returns a SignatureDoesNotMatch error instead of a CORS error. The symptom looks similar -- the upload fails in the browser but works in curl -- but the root cause is in the presigned URL generation, not in CORS. The fix is to include Content-Type in the SignedHeaders when generating the presigned URL.

### Bucket policy denies OPTIONS

A restrictive bucket policy explicitly denies all HTTP methods except GET and PUT. CORS is configured on the bucket, but S3 never gets to evaluate it because the bucket policy denies the OPTIONS preflight request first. The fix is to ensure the bucket policy does not deny OPTIONS when CORS is required.

## SOP Best Practices

1. When enabling direct browser uploads to S3, configure CORS on the bucket and verify it with a preflight test using `curl -X OPTIONS` before deploying to production.
2. When placing CloudFront in front of S3 with browser access expected, attach the AWS-managed CORS-S3Origin origin request policy (ID: `88a5eaf4-2fd4-4709-b370-b4c650ea3fcf`) to forward Origin, Access-Control-Request-Headers, and Access-Control-Request-Method headers.
3. After any CORS or CloudFront origin request policy change, create a cache invalidation for `/*` to clear stale cached responses that lack CORS headers from edge locations.
4. Add CORS verification to the team's deployment checklist for any feature involving browser-to-S3 direct access, including presigned URL uploads and static asset hosting.

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
