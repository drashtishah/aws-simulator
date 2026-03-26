---
tags:
  - type/simulation
  - service/bedrock
  - service/cloudwatch
  - service/lambda
  - service/sns
  - difficulty/associate
  - category/reliability
---

# Resolution -- The Guardrail and the Doctor

## Root Cause

The Bedrock Guardrail `patchwork-clinical-safety` (version 3) contained a denied topic called "Medical Advice and Diagnosis" with an overly broad definition and example phrases. The topic was configured to evaluate user input, and its example phrases -- "chest pain," "shortness of breath," "symptoms of," "medication for" -- matched the exact language patients use when describing symptoms to the triage assistant. Since the assistant's entire purpose is symptom collection, 40% of legitimate queries triggered the denied topic filter and were blocked before reaching the foundation model.

The SNS topic `patchwork-guardrail-alerts` had zero subscribers, so the spike in guardrail interventions went unnoticed for two days.

## Timeline

| Time | Event |
|------|-------|
| Monday 09:14 UTC | Compliance engineer updates Bedrock Guardrail from version 2 to version 3, adding "Medical Advice and Diagnosis" denied topic |
| Monday 09:20 UTC | Engineer tests five adversarial prompts, all correctly blocked |
| Monday 09:25 UTC | Version 3 deployed to production |
| Monday 09:30 UTC | Guardrail interventions begin spiking; ~40% of patient queries now blocked |
| Monday - Wednesday | SNS alert topic has no subscribers; no notifications sent |
| Wednesday 08:45 UTC | Patient support escalates 23 complaints about assistant refusing to help |
| Wednesday 09:10 UTC | Clinical operations analyst pulls metrics, confirms 440 blocked queries per day |
| Wednesday 09:30 UTC | Investigation begins |

## Correct Remediation

1. **Narrow the denied topic definition**: Change the definition from "Queries seeking medical diagnosis, treatment recommendations, or clinical advice" to "Responses that provide specific medical diagnoses, prescribe medications, or recommend treatment plans." This targets the actual prohibited behavior (the model acting as a doctor) rather than the patient describing symptoms.

2. **Update example phrases to match output, not input**: Replace input-matching phrases like "chest pain" and "shortness of breath" with output-matching phrases like "you likely have," "I recommend taking," "your diagnosis is," and "you should take [medication]."

3. **Apply denied topic filter to output, not input**: Configure the guardrail to evaluate the model's response rather than the user's input for the medical advice topic. This allows patients to describe symptoms freely while still preventing the model from crossing into diagnosis or prescription.

4. **Subscribe the operations team to the SNS alert topic**: Add the on-call clinical engineering distribution list as a subscriber to `patchwork-guardrail-alerts` so guardrail intervention spikes trigger immediate notification.

5. **Add a CloudWatch alarm**: Create an alarm on the `GuardrailInterventions` metric with a threshold of 50 interventions per hour, connected to the SNS alert topic.

6. **Test guardrail changes against legitimate queries**: Establish a test suite of representative patient queries (symptom descriptions, medication questions, appointment requests) alongside adversarial prompts. Run both sets against any guardrail configuration change before deployment.

## Key Concepts

### Bedrock Guardrails -- Denied Topics

Denied topics in Amazon Bedrock Guardrails allow you to define subjects the model should not engage with. Each topic has a name, definition, and example phrases. The guardrail evaluates text against these topics and blocks any match. Topics can be applied to user input, model output, or both. Overly broad definitions create false positives, especially in domain-specific applications where the "denied" language is the application's core vocabulary.

### Input vs Output Filtering

Guardrail filters can be applied at two stages: on the user's input before it reaches the model, and on the model's output before it reaches the user. Input filtering prevents the model from seeing certain requests. Output filtering lets the model process the request but blocks the response if it violates policy. For use cases where user input naturally contains domain-specific language (medical, legal, financial), output filtering is often more appropriate for topic-based controls.

### Guardrail Testing Strategy

Testing guardrails only against adversarial prompts creates a blind spot. A guardrail that blocks all five adversarial test cases may also block 40% of legitimate queries. Effective testing requires a representative sample of real production queries alongside adversarial ones, with pass/fail criteria for both: adversarial queries should be blocked, legitimate queries should pass through.

## AWS Docs Links

- [Amazon Bedrock Guardrails -- Denied Topics](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-denied-topics.html)
- [Amazon Bedrock Guardrails -- How It Works](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-how.html)
- [Amazon Bedrock Guardrails -- Testing](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-test.html)
- [Amazon CloudWatch Metrics for Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-cw.html)
- [Amazon SNS -- Subscribing to a Topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html)

## Learning Objectives

- How Bedrock Guardrails denied topics evaluate and intercept user input before it reaches the foundation model
- The importance of testing guardrail configurations against legitimate use-case queries, not just adversarial ones
- Balancing AI safety controls with application functionality in domain-specific contexts
- Setting up alerting on guardrail intervention rates to detect false-positive spikes

## Related

- [[Bedrock Guardrails -- Denied Topics]]
- [[Content Filtering -- Input vs Output]]
- [[CloudWatch Alarms for AI Services]]
