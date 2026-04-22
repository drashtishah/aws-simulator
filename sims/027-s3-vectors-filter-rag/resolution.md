---
tags:
  - type/resolution
  - service/s3-vectors
  - service/bedrock
  - service/opensearch-serverless
  - service/cloudwatch
  - difficulty/professional
  - category/data
---

# Resolution: The Filter That Lost the Answer

## Root Cause

The S3 Vectors index that backs the legal-research assistant uses HNSW pre-filtering on the `jurisdiction` metadata field. HNSW is a graph algorithm that finds approximate nearest neighbors by walking from a starting node toward the query embedding through a multi-layer graph. Pre-filtering rejects non-matching nodes during the walk. When the filter is narrow (state=NY is 6% of the corpus), the rejection removes bridge nodes, which are the vectors that connect dense clusters to the broader graph. Traversal ends up stranded in a small NY cluster that is not actually close to the question embedding. The index returns the top-K from that cluster. The results are all NY (they pass the filter) but semantically irrelevant. The reported similarity scores land in a narrow band above the retriever's cutoff because 8-bit quantization adds noise, so no alarm fires. The generator builds a confident, wrong answer from the bad context.

## Timeline

| Time (UTC) | Event |
|---|---|
| Day -90 | S3 Vectors index `lex-approximate-cases-v3` created. HNSW pre-filter is the SDK default and is enabled. |
| Day -90 to Day 0 | 500-question nightly eval runs green. All questions are unfiltered. |
| Day -7 to Day 0 | A few filtered-query complaints trickle in but are attributed to user error; nobody correlates them. |
| Day 0, 08:54 | Senior associate at the Manhattan firm tries to pull the cases the assistant cited on Westlaw. None of them are real. |
| Day 0, 09:18 | Complaint reaches head of product, who pings engineering. |
| Day 0, 09:42 | Engineer reproduces the failure with jurisdiction=NY and a minimal prompt. Without the filter, the answer is correct. |
| Day 0, 10:11 | Engineer logs the full relevance-score vectors and sees a flat distribution for filtered queries. |
| Day 0, 10:47 | Cross-validation against OpenSearch Serverless eval collection returns a different, relevant set of NY cases. |
| Day 0, 12:00 | Retriever patched to post-filter at K=200. Reproduction question answers correctly. Deployed to production. |
| Day 0, 14:00 | Eval suite extended with a filtered variant of every golden question. CI gate added. |
| Day +3 | Per-jurisdiction indexes built for the top-12 filter values, global index kept as fallback with post-filter. |

## Correct Remediation

1. **Reproduce with a controlled test.** Pick the exact question the user asked. Run it with the filter and without the filter. Compare the top-K results side by side. Entirely different document sets with similar relevance scores is the signature of fragmented HNSW traversal.
2. **Inspect relevance-score distributions.** Healthy retrieval has a clear top-1 that scores noticeably higher than top-5 and top-10. A flat distribution across the top-K is a strong indicator that the index is returning from a limited candidate pool. Log the full score vector, not just the top-1.
3. **Cross-validate against a second index.** Run the same filtered question against OpenSearch Serverless (or any second retriever). If the second index returns clearly relevant documents for the same filter, the first index's traversal is the problem, not the embeddings or the filter value.
4. **Confirm embeddings are fine.** Pick a document that should match, fetch its vector, and compute cosine similarity against the question's embedding directly. If the similarity is high but the index did not return the document, the index's traversal excluded it. This localizes the failure to HNSW traversal, not the embedding model or the ingest pipeline.
5. **Switch to post-filtering at higher K.** Retrieve top-100 or top-200 unfiltered, then filter in application code and take top-10. This preserves HNSW connectivity and costs a small amount of extra latency. For narrow filters this is the single most effective change.
6. **Partition the corpus by the filter field for dominant filter values.** Build one index per jurisdiction for the top N jurisdictions covering most queries. Each per-jurisdiction index's HNSW graph is internally connected, so traversal never needs to cross a filter boundary. The global index stays around with post-filter for long-tail filter values.
7. **Add an absolute relevance floor.** If the top-1 post-filter score is below a calibrated minimum (measured on the eval set), return an empty context. The generator then produces a no-answer response. A calibrated "I do not have enough information" is better than a confident wrong citation.
8. **Extend the eval suite to cover filters.** For every golden question, include filtered variants for the jurisdictions that question plausibly applies to. Compare filtered recall against unfiltered recall per jurisdiction. Fail CI if filtered recall drops by more than a calibrated threshold.
9. **Harden the generator prompt.** Require the generator to cite only case identifiers that appear verbatim in the retrieved chunks. Validate programmatically: if a generated citation is not in the context, fail closed and return a no-answer response.

## Key Concepts

### Why HNSW pre-filtering breaks for narrow filters

HNSW is a graph. Each node is a vector. Edges connect vectors that are close in the embedding space. Some of those edges are "bridges" that link otherwise separate dense regions of the graph. A query walk moves from an entry node toward the query embedding by following the best edges at each step. Pre-filtering means: during the walk, any node whose metadata does not match the filter is immediately rejected, and the walk continues through remaining candidates. This is fast. The trouble is that bridge nodes disproportionately do not match narrow filters, because narrow filters are narrow precisely because they exclude most of the corpus. Remove the bridges, and the walk cannot cross from its starting region to the actual dense region of matching vectors. It stalls in whatever local cluster it can still reach and returns results from there. Post-filtering avoids this: the walk runs ignoring the filter, returns the top-K by vector distance, and the filter is applied at the end. More results get rejected post-hoc, so you need a larger K to guarantee enough matches, but traversal is never fragmented.

### Why relevance scores can look fine even when retrieval is broken

S3 Vectors uses 8-bit quantization on stored vectors to save space and speed up comparisons. The quantization adds a small amount of noise to each distance calculation. When traversal is healthy, the top-1 result is noticeably closer to the query than the 50th; the noise is small compared to the true distance spread. When traversal is broken and all returned results come from one small stranded cluster, the results are all roughly the same distance from the query (because they are all roughly equally irrelevant). The noise now dominates the score spread. The scores come out as a narrow band above the relevance cutoff, looking healthy in aggregate. A retriever that uses a percentile threshold ("always return the top-10") cannot distinguish this from real retrieval. An absolute floor can.

### Cross-validation as an incident tool

Keeping a second retrieval index (for example OpenSearch Serverless with keyword search) around, even if you do not use it for live serving, pays for itself during incidents. It gives you a cheap consistency check: run the same question through both indexes, compare the returned sets, and if they diverge wildly you know something is wrong with the primary index. This is different from an eval suite that runs on a schedule; it is an ad-hoc query tool for live investigation.

## Other Ways This Could Break

### The corpus is stale because ingest silently skipped a batch
Retrieval logic is fine. Filter logic is fine. But the last ingest skipped new case law for two weeks, so the assistant's most recent NY Appellate Division cases are from early March. A user asks about a ruling from last week and the assistant confidently cites a related older case as if it were the current state of the law.
**Prevention:** Track a freshness metric per jurisdiction in CloudWatch: the timestamp of the newest document. Alarm when freshness falls behind the publication cadence by more than a day. Make ingest success a deployment gate.

### Chunking cuts a case's reasoning in half at the embedding boundary
The retriever returns the right document, but the chunk it returns contains the citation without the reasoning behind it, because the chunker split on a fixed token count in the middle of a paragraph. The generator has no context for the citation and fabricates a justification.
**Prevention:** Use semantic chunking that splits on paragraph or section boundaries. Include some token overlap between consecutive chunks. Evaluate chunk quality on a held-out set of multi-paragraph reasoning questions.

### The generator invents citations when the context is thin
Retrieval works, the filter works, the chunks are relevant. But on questions where the context is sparse, the model fills the gap with plausible-sounding case names that do not exist. The system prompt does not forbid this.
**Prevention:** Write the system prompt to forbid generating any citation not present verbatim in the provided context. Programmatically validate each generated citation against the context after generation; if a citation is not found, fail closed and return a no-answer response. Log every fail-closed event to CloudWatch as a metric.

## SOP Best Practices

- Evaluate filter configurations, not just the unfiltered baseline. A RAG system that passes eval without filters can still fail badly on narrow filters. Include filtered variants in every golden-question suite.
- Reach for architectural fixes before parameter tuning. Post-filter, partition, and dual-retrieval are structural levers. Raising K or tweaking HNSW parameters cannot compensate for a fragmented graph.
- Enforce an absolute relevance floor on every retriever. Below the floor, return no context. A calibrated no-answer is better than a confident wrong citation, especially in legal, medical, and financial research.
- Keep a second retrieval index around for cross-validation. OpenSearch Serverless keyword search is a cheap consistency check during incidents.

## Learning Objectives

1. **HNSW and metadata filters**: Understand how pre-filtering interacts with graph traversal and why narrow filters fragment the graph.
2. **Diagnosing retrieval quality failures**: Use score distributions, cross-validation, and direct vector similarity to localize failures between embeddings, filters, and traversal.
3. **Architectural levers for narrow-filter retrieval**: Know when to post-filter at higher K, when to partition the corpus, and when to add a keyword fallback.
4. **RAG safety patterns**: Apply a relevance floor, verbatim-citation requirement, and fail-closed behavior for high-stakes domains.

## Related

- [[exam-topics#SAP-C02 -- Solutions Architect Professional]] -- Domain 2: Design for New Solutions
- [[learning/catalog.csv]] -- Player service catalog and progress
