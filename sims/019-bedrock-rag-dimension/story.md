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

# One Thousand and Twenty-Four

## Opening

The retrieval was returning results. That was the confusing part. Every query produced three or four citations, neatly formatted with case numbers and paragraph summaries. They were the wrong citations.

Terravox provides legal research tools to 120 law firms. Thirty-eight engineers. Their AI assistant uses Amazon Bedrock Knowledge Bases to search a corpus of 280,000 legal documents stored in S3, with an OpenSearch Serverless collection as the vector store. The system had been running for four months. Retrieval precision held steady at 0.91. The lawyers trusted it.

Thursday afternoon, the ML team upgraded the embedding configuration. Amazon Titan Embeddings V2, reconfigured from 512 dimensions to 1,024. The change was meant to improve retrieval quality. The data source sync ran that evening. It completed without error. All 280,412 documents indexed.

Friday morning, an associate at Whitfield & Associates cited a landlord-tenant dispute in a securities fraud brief. The case existed. It was a real case, with a real docket number. It just had nothing to do with securities. The associate had used the Terravox assistant to find it.

## Resolution

The ML engineer changed the Titan V2 embedding configuration from 512 dimensions to 1,024. The knowledge base data source sync ran clean -- 280,412 documents scanned, 280,412 documents indexed, zero errors. But the OpenSearch Serverless index still had `"dimension": 512` in its knn_vector field mapping. OpenSearch Serverless does not allow in-place changes to an index mapping's dimension parameter. The 1,024-dimension vectors produced by the updated model were silently truncated to fit the 512-dimension index. Half of each vector was discarded. The remaining values retained no coherent semantic meaning. Every nearest-neighbor search returned results, but the results were effectively random.

The fix required deleting the existing OpenSearch Serverless index and recreating it with `"dimension": 1024` in the knn_vector mapping. Then a full re-sync of the knowledge base data source to re-embed and re-index all 280,412 documents with properly stored 1,024-dimension vectors. The re-sync took approximately forty minutes.

The deeper fix was a CI validation step that compares the Bedrock Knowledge Base embedding model configuration against the OpenSearch index mapping before any deployment. The dimension parameter in the model config must match the dimension parameter in the index mapping. This check did not exist. The sync API does not perform it. The mismatch was invisible to every existing alarm and metric. Only retrieval quality -- measured by precision and recall against a regression test suite -- showed the failure. That metric was not wired to an alarm. It is now.
