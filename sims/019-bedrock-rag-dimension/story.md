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

company: Terravox
industry: legal technology, growth-stage startup, 38 engineers
product: AI legal research assistant using Amazon Bedrock Knowledge Bases, searches corpus of 280,000 legal documents stored in S3, OpenSearch Serverless collection as vector store
scale: 120 law firms, system running for 4 months, retrieval precision steady at 0.91
time: Friday morning (embedding change Thursday afternoon, sync Thursday evening)
scene: law firm associate filed a brief citing wrong case found by Terravox assistant
alert: retrieval returning results for every query but citations are wrong -- irrelevant cases with real docket numbers
stakes: lawyers trusting the system for brief preparation; associate at Whitfield & Associates cited a landlord-tenant dispute in a securities fraud brief (real case, real docket number, completely unrelated jurisdiction)
early_signals:
  - Thursday afternoon, ML team upgraded embedding configuration: Amazon Titan Embeddings V2 reconfigured from 512 dimensions to 1,024, intended to improve retrieval quality
  - Thursday evening, data source sync ran and completed without error -- 280,412 documents indexed
  - Friday morning, Whitfield & Associates associate cited wrong case in filed brief
  - every query produces 3-4 citations, neatly formatted with case numbers and paragraph summaries, all irrelevant
investigation_starting_point: retrieval is returning results for every query, but the results are wrong. The sync completed cleanly. The source documents are intact. Something changed in the embedding pipeline.

## Resolution

root_cause: ML engineer changed Titan V2 embedding configuration from 512 dimensions to 1,024. OpenSearch Serverless index (terravox-legal-index) still had "dimension": 512 in its knn_vector field mapping. OpenSearch Serverless does not allow in-place changes to an index mapping dimension parameter.
mechanism: 1,024-dimension vectors produced by updated model were silently truncated to fit the 512-dimension index. Half of each vector discarded. Remaining values retained no coherent semantic meaning. Every nearest-neighbor search returned results, but results were effectively random. Knowledge base data source sync ran clean -- 280,412 documents scanned, 280,412 indexed, zero errors.
fix: delete existing OpenSearch Serverless index and recreate with "dimension": 1024 in knn_vector mapping, then full re-sync of knowledge base data source to re-embed and re-index all 280,412 documents. Re-sync took approximately 40 minutes.
contributing_factors:
  - no CI validation step comparing Bedrock Knowledge Base embedding model configuration against OpenSearch index mapping
  - sync API does not validate dimension compatibility
  - dimension mismatch invisible to every existing alarm and metric
  - only retrieval quality (precision and recall against regression test suite) showed the failure, and that metric was not wired to an alarm
