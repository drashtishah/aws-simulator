---
tags:
  - type/simulation
  - service/s3-vectors
  - service/bedrock
  - service/opensearch-serverless
  - service/cloudwatch
  - difficulty/professional
  - category/data
---

# The Filter That Lost the Answer

## Opening

- company: Lex Approximate
- industry: legal research AI
- product: a natural-language case-law research assistant used by mid-market law firms. Users ask legal questions and can filter by jurisdiction, court level, and year.
- scale: Series A, 40 lawyers on the editorial board, 12 engineers, about 1,700 seats across 48 customer firms. The corpus is around 4.2 million case headnotes and holdings from state and federal courts.
- time: Monday 09:18 AM local
- scene: the head of product forwards an email from the head of litigation at a Manhattan firm who is the company's third-largest customer
- alert: senior associate at the client firm says: "your assistant cited three New York Appellate Division cases that do not exist. I pulled Westlaw."
- stakes: legal research assistants are held to a correctness bar that tolerates zero invented citations. Two competitors have publicly had hallucination incidents and lost customers. The renewal conversation with this firm is in four weeks.
- early_signals:
  - The failure only reproduces when a jurisdiction filter is set. Same question, no filter, returns one real relevant case.
  - The filtered results have uniformly high relevance scores (0.88, 0.87, 0.87, 0.86) while the unfiltered top result scores 0.94 with a clear drop-off.
  - CloudWatch retrieval logs show s3vectors:QueryVectors returning K results in both cases; no errors.
  - The eval suite runs nightly on a 500-question golden set. Last night's run was green. All 500 questions are unfiltered.
- investigation_starting_point: head of engineering has the retrieval logs open. The filtered and unfiltered queries clearly return different top-K chunks. The retriever's relevance score distribution looks suspicious for the filtered case but the numbers are still above the cutoff threshold. Something about filters is different.

## Resolution

- root_cause: the S3 Vectors index lex-approximate-cases-v3 has HNSW pre-filtering enabled on the jurisdiction metadata field. For narrow filter values, pre-filtering removes bridge nodes from the HNSW graph during traversal. The traversal, unable to cross to the dense New York subregion, lands in whatever small cluster of NY vectors is reachable from the entry point and returns the top-K from that cluster. Those vectors are all NY (they pass the filter) but are semantically far from the question. Because S3 Vectors' internal distances use 8-bit quantization, the reported similarity scores land in a narrow band above the retriever's relevance cutoff, so the retriever does not flag them as low-quality. The generator receives plausible NY context, is instructed to cite only provided sources, and composes an answer that cites NY cases with made-up holdings.
- mechanism: the graph has roughly 4.2M nodes. About 6% (around 250k) are tagged state=NY. At ingest time HNSW built layers based on global connectivity. Bridge nodes (which are non-NY in about 94% of cases) connect NY subclusters to the wider graph and to each other. When pre-filter rejects non-NY nodes mid-traversal, the walk loses its cross-cluster routes. It reaches one NY cluster, enumerates candidates there, and returns. The nearest cluster to the query embedding happens to be about civil-procedure cases, and the question was about a contract-law holding; the cluster contains contract-law cases from 1987-1994 that were never cited because the retriever always returned more recent, more relevant holdings before.
- fix: the retrieval engineer changes the query path to post-filter at K=200 (retrieve 200 nearest neighbors with no filter, then trim by jurisdiction in Python, then take top-10). Relevance immediately recovers on the reproduction question. Follow-up work replaces the single global index with one index per jurisdiction for the top-12 jurisdictions (covering 91% of queries) and keeps the global index with post-filter for the rest. The retriever also gains a relevance floor: if the top-1 post-filtered score is below a calibrated 0.80, the retriever returns an empty context and the generator produces a no-answer response with an explanation. The eval suite is expanded to include a filtered variant of every golden question, and the CI gate fails if filtered recall on any jurisdiction drops by more than 5% versus the unfiltered baseline.
- contributing_factors:
  - HNSW pre-filtering is the default in the S3 Vectors SDK at index-creation time; switching to post-filter required application-side code changes that nobody had a reason to make.
  - The eval suite never ran filtered queries, so the degradation was invisible in CI.
  - The retriever's relevance cutoff was a percentile threshold (top-10 always returned), not an absolute floor, so it could not detect that the top-10 itself was garbage.
  - Quantization noise masked the score collapse. Without quantization, the filtered top-K scores would have fallen below the cutoff and the retrieval would have returned empty.
  - The generator prompt did not require verbatim citation matching against retrieved chunks, so it did not catch that the generated citation numbers were not present in any chunk.
