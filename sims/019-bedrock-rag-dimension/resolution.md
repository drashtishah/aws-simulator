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

1. **Delete the existing OpenSearch Serverless index** -- the `terravox-legal-index` index cannot have its knn_vector dimension changed in place
2. **Recreate the index with the correct mapping** -- set `"dimension": 1024` in the knn_vector field to match the embedding model output
3. **Re-sync the knowledge base data source** -- trigger a full ingestion job to re-embed all documents and store the full 1,024-dimension vectors
4. **Validate retrieval quality** -- run the regression test suite to confirm precision returns to baseline
5. **Add a CI validation check** -- compare the embedding model's configured dimensions against the OpenSearch index mapping's dimension parameter before any deployment reaches production
6. **Wire retrieval precision to a CloudWatch alarm** -- the existing alarms covered latency and availability but not retrieval quality

## Key Concepts

### Vector Dimensions and Embedding Models

Embedding models convert text into dense numerical vectors. The dimensionality of these vectors is a fixed property of the model configuration. Amazon Titan Embeddings V2 supports configurable dimensions (256, 512, or 1,024). Higher dimensions capture more semantic nuance but require more storage and compute. The critical constraint is that the vector store must be configured to accept the exact number of dimensions the model produces. A mismatch means data loss.

### OpenSearch Serverless Index Mappings

OpenSearch Serverless vector search collections store vectors in fields of type `knn_vector`. The `dimension` parameter in the field mapping is set at index creation time and cannot be changed afterward. The mapping also specifies the engine (faiss or nmslib), the distance metric (l2, cosinesimil, innerproduct), and the algorithm (hnsw). When a vector with more dimensions than the mapping allows is indexed, the extra dimensions are silently dropped. There is no error, no warning, and no log entry.

### RAG Pipeline Silent Failure Modes

Retrieval-Augmented Generation pipelines have a failure mode that traditional monitoring does not catch. The system can be fully operational -- all services healthy, all API calls succeeding, all ingestion jobs completing -- while returning completely wrong results. This happens because correctness is a property of the data, not the infrastructure. Monitoring latency, error rates, and availability will not detect a retrieval quality regression. The only way to catch these failures is to measure retrieval quality directly, using precision, recall, or NDCG against a known evaluation dataset.

## Other Ways This Could Break

### Embedding model swapped to a different model family
The knowledge base embedding model ARN is changed from Titan V2 to a Cohere or third-party model with a different default vector size. The same silent truncation occurs, but the cause is a model swap rather than a dimension reconfiguration. A pre-deployment check that resolves the model ARN, queries its output dimensions, and compares against the index mapping would prevent this.

### KMS key for OpenSearch Serverless collection rotated or deleted
The AWS KMS key used to encrypt the OpenSearch Serverless collection becomes unavailable due to deletion, key policy change, or rotation failure. Unlike a dimension mismatch, this produces hard errors -- both ingestion and retrieval fail with access denied. The failure is loud and immediate. Prevention: use KMS key policies that prevent accidental deletion, and alarm on KMS key state changes.

### Chunking strategy changed without full re-index
The chunk size or overlap parameters in the data source configuration are modified, but only newly added documents are re-chunked during the next incremental sync. Existing documents keep their old chunk boundaries. Retrieval quality degrades gradually rather than catastrophically. Prevention: trigger a full re-sync after any chunking configuration change and monitor retrieval quality metrics continuously.

### OpenSearch Serverless collection hits indexing capacity limits
The collection runs out of available OCUs for indexing. Some vectors are indexed and some are silently dropped. The ingestion job may show fewer documents indexed than scanned. Unlike the dimension mismatch where all vectors are bad, here some results are correct and others are missing. Prevention: monitor OCU consumption and alarm when utilization exceeds 80%.

## SOP Best Practices

- Always validate that the embedding model's output dimensions match the vector store index mapping dimensions before deploying any change to either component. Automate this check in CI/CD.
- Treat retrieval quality metrics (precision, recall, NDCG) as first-class operational metrics. Wire them to CloudWatch alarms with the same urgency as latency and error rate alarms.
- After any change to the embedding model, chunking strategy, or index configuration, run a full data source re-sync followed by a regression test suite. Never assume incremental syncs preserve quality.
- Document the relationship between your embedding model configuration and your vector store index schema in a single source of truth. When one changes, the other must be reviewed.

## Learning Objectives

- Vector dimensions in embedding models must exactly match the vector store index configuration. A mismatch causes silent data corruption.
- OpenSearch Serverless index mappings are immutable after creation. Changing the dimension requires deleting and recreating the index.
- RAG pipeline ingestion can succeed with zero errors while producing semantically meaningless vectors. Success status does not imply correctness.
- Retrieval quality metrics (precision, recall, NDCG) are operational metrics, not just ML experiment metrics. They should be monitored and alarmed on in production.

## Related

- [[011-nat-gateway-cost]] -- another silent cost/quality issue with no errors in logs
- [[009-credential-chain]] -- silent failure where the wrong credential is used without error
