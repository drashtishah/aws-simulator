---
tags:
  - type/simulation
  - service/bedrock
  - service/opensearch-serverless
  - service/s3
  - service/cloudwatch
  - difficulty/associate
  - category/data
---

# Resolution: One Thousand and Twenty-Four

## Root Cause

The Amazon Bedrock Knowledge Base embedding model (Amazon Titan Embeddings V2) was reconfigured from 512 dimensions to 1,024 dimensions. The OpenSearch Serverless index used as the vector store retained its original knn_vector mapping with `"dimension": 512`. When the knowledge base data source sync ran, the 1,024-dimension embedding vectors were silently truncated to 512 dimensions during indexing. This destroyed the semantic relationships encoded in the vectors. Nearest-neighbor searches continued to return results, but the results had no meaningful similarity to the query vectors.

## Timeline

| Time | Event |
|---|---|
| Thursday 14:30 | ML engineer updates Bedrock Knowledge Base embedding model configuration from 512 to 1,024 dimensions |
| Thursday 18:00 | Automated data source sync begins. 280,412 documents scanned and indexed |
| Thursday 19:12 | Data source sync completes. Status: COMPLETE. Zero errors reported |
| Friday 08:15 | Associate at Whitfield & Associates files brief citing irrelevant case found via Terravox assistant |
| Friday 09:40 | Whitfield partner contacts Terravox support directly |
| Friday 10:00 | QA regression suite shows retrieval precision dropped from 0.91 to 0.12 |
| Friday 10:30 | Root cause identified: dimension mismatch between embedding model config and OpenSearch index mapping |
| Friday 11:00 | OpenSearch index deleted and recreated with 1,024-dimension mapping |
| Friday 11:45 | Knowledge base data source re-sync completes. Retrieval precision returns to 0.93 |

## Correct Remediation

1. **Delete the existing search index** -- The OpenSearch Serverless index (terravox-legal-index) cannot have its vector size changed after creation. The dimension setting (how many numbers each vector contains) is locked when the index is first built. You must delete the index entirely and start fresh.
2. **Recreate the index with the correct vector size** -- Set "dimension": 1024 in the knn_vector field mapping to match what the embedding model now produces. The knn_vector field type is what OpenSearch uses to store vectors and perform similarity searches.
3. **Re-import all documents** -- Trigger a full ingestion job on the knowledge base data source. This re-reads all 280,412 documents from S3, converts each chunk into a 1,024-number vector using the embedding model, and stores the full-length vectors in the new index.
4. **Verify search quality is restored** -- Run the regression test suite to confirm retrieval precision (the fraction of returned results that are actually relevant) returns to baseline.
5. **Prevent future mismatches automatically** -- Add a CI validation step that compares the embedding model's configured dimension count against the OpenSearch index mapping's dimension parameter before any deployment reaches production. If they do not match, the deployment should fail.
6. **Set up a quality alarm** -- The existing alarms covered latency (how fast) and availability (whether it is up), but not retrieval quality (whether the answers are correct). Wire the RetrievalPrecision metric to a CloudWatch alarm that triggers below 0.80.

## Key Concepts

### What are vector dimensions, and why do they have to match?

An embedding model converts text into a vector -- a list of numbers that represents the meaning of that text. Think of it as a fingerprint for what the text is about. The number of values in that list is called the dimension. Amazon Titan Embeddings V2 lets you choose 256, 512, or 1,024 dimensions. More dimensions capture finer shades of meaning but use more storage and computing power. The critical rule is that the search index must be configured to accept exactly as many dimensions as the model produces. If the model outputs 1,024 numbers but the index only accepts 512, the extra 512 numbers are silently chopped off -- and the remaining half-vector has no coherent meaning.

### Why you cannot just change the index -- OpenSearch Serverless index mappings

OpenSearch Serverless stores vectors in a special field type called knn_vector. When you create the index, you set the dimension parameter (how many numbers each vector contains), along with the search algorithm (such as HNSW, which builds a graph structure for fast similarity search) and the distance metric (how similarity is calculated). Once set, the dimension cannot be changed. The index must be deleted and recreated. When a vector with more dimensions than the mapping allows is written, the extra values are silently dropped -- no error, no warning, no log entry.

### Everything looks healthy but the answers are wrong -- RAG pipeline silent failures

Retrieval-Augmented Generation (RAG) pipelines have a failure mode that traditional monitoring cannot catch. Every service can be healthy, every API call can succeed, and every ingestion job can complete -- while the system returns completely wrong results. This happens because correctness is a property of the data, not the infrastructure. Monitoring latency (how fast), error rates (how many failures), and availability (whether it is up) will not detect a search quality regression. The only way to catch these failures is to measure search quality directly, using metrics like precision (how many results are relevant), recall (how many relevant results were found), or NDCG (a ranking quality score) against a known test dataset.

## Other Ways This Could Break

### Someone swaps the embedding model to a completely different one
The embedding model ARN is changed from Titan V2 to a Cohere or third-party model that produces vectors of a different size. The same silent truncation happens, but the root cause is a model swap rather than a dimension setting change. This may be harder to catch in a code review because the configuration field that changed is the model ARN, not the dimension number. A pre-deployment check that looks up the model, determines its output dimensions, and compares against the index mapping would prevent this.

### The encryption key for the OpenSearch collection becomes unavailable
The collection is encrypted using an AWS KMS key (a managed encryption key). If that key is deleted, disabled, or its permissions are changed, the collection becomes inaccessible. Unlike the dimension mismatch, this failure is loud and immediate -- both ingestion and search fail with access denied errors. Use KMS key policies that prevent accidental deletion, and set up CloudWatch alarms on KMS key state changes.

### Document splitting settings are changed but existing documents keep their old chunks
The chunking strategy (how documents are split into smaller pieces for indexing) is modified -- for example, making chunks larger or changing the overlap between them. But during the next sync, only newly added documents get the new chunking. Existing documents keep their old chunk boundaries. Search quality degrades gradually rather than suddenly, making the problem harder to spot. After any chunking change, run a full re-sync (not incremental) so all documents are re-split. Monitor retrieval quality metrics continuously.

### The OpenSearch collection runs out of capacity and silently drops documents
OpenSearch Serverless collections have capacity limits measured in OCUs (OpenSearch Compute Units). If the collection runs out of indexing capacity, some vectors are stored and others are quietly skipped. Unlike the dimension mismatch (where all vectors are corrupted), here some search results are correct and others are simply missing. The ingestion job may show fewer documents indexed than scanned. Monitor OCU consumption and set alarms when utilization exceeds 80%. After every sync, compare the documents-scanned count to the documents-indexed count.

## SOP Best Practices

- Before deploying any change to the embedding model or the search index, verify that the vector dimensions match. The model produces vectors of a certain length; the index must accept exactly that length. Automate this comparison in your CI/CD pipeline so a mismatch is caught before it reaches production.
- Treat search quality metrics as real operational metrics, not just experiment numbers. Precision (how many results are relevant), recall (how many relevant results were found), and NDCG (a ranking quality score) should have CloudWatch alarms with the same urgency as latency and error rate alarms.
- After any change to the embedding model, document splitting strategy, or index configuration, run a full data source re-sync followed by a regression test suite. Do not assume an incremental sync (which only processes new or changed documents) will preserve quality -- old documents may have incompatible vectors.
- Keep a single source of truth that documents the relationship between your embedding model (which model, how many dimensions) and your search index schema (which dimension the index expects). When one changes, the other must be reviewed.

## Learning Objectives

- Vector dimensions in embedding models must exactly match the vector store index configuration. A mismatch causes silent data corruption.
- OpenSearch Serverless index mappings are immutable after creation. Changing the dimension requires deleting and recreating the index.
- RAG pipeline ingestion can succeed with zero errors while producing semantically meaningless vectors. Success status does not imply correctness.
- Retrieval quality metrics (precision, recall, NDCG) are operational metrics, not just ML experiment metrics. They should be monitored and alarmed on in production.

## Related

- [[011-nat-gateway-cost]] -- another silent cost/quality issue with no errors in logs
- [[009-credential-chain]] -- silent failure where the wrong credential is used without error
