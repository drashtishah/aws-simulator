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

1. **Rewrite the denied topic definition so it targets the right thing.** The current definition says "Queries seeking medical diagnosis, treatment recommendations, or clinical advice" -- which describes what patients type. Change it to "Responses that provide specific medical diagnoses, prescribe medications, or recommend treatment plans." The goal is to stop the model from acting as a doctor, not to stop patients from describing their symptoms.

2. **Replace the example phrases so they match model output, not patient input.** Remove phrases like "chest pain" and "shortness of breath" -- those are exactly what patients need to type. Replace them with phrases the model would say if it crossed the line: "you likely have," "I recommend taking," "your diagnosis is," and "you should take [medication]."

3. **Move the filter from input to output.** A guardrail can check two things: what the user sends in (input filtering) and what the model sends back (output filtering). Right now the denied topic is set to block user input. Flip it: set inputAction to NONE and outputAction to BLOCK. This lets patients describe symptoms freely while still catching the model if it tries to diagnose or prescribe.

4. **Connect someone to the alert channel.** The SNS topic `patchwork-guardrail-alerts` exists but has zero subscribers -- meaning it fires alerts into the void. SNS (Simple Notification Service) is AWS's notification system. Add the on-call clinical engineering distribution list as a subscriber so the team gets paged immediately when guardrail intervention rates spike.

5. **Set up an automated alert on block rate.** Create a CloudWatch alarm -- an automated rule that watches a metric and triggers when it crosses a threshold -- on the `GuardrailInterventions` metric. Set it to fire at 50 interventions per hour and connect it to the SNS alert topic.

6. **Build a test suite for future guardrail changes.** Collect a set of representative patient queries (symptom descriptions, medication questions, appointment requests) alongside adversarial prompts (requests the guardrail should block). Before deploying any guardrail change, run both sets through it and verify that bad queries get blocked and legitimate queries pass through.

## Key Concepts

### Bedrock Guardrails -- Denied Topics

A Bedrock Guardrail is a safety filter that sits between users and an AI model. One of its features is denied topics -- subjects you tell the guardrail to reject. You define each topic with a name, a plain-language definition, and a few example phrases. When the guardrail sees text that matches a denied topic, it blocks that text. You can choose to apply each topic to user input, model output, or both. The danger: if you define a topic too broadly, the guardrail will block legitimate requests. This is especially common in specialized applications where the "forbidden" vocabulary is the same vocabulary users need to use -- for example, medical symptom descriptions in a health triage app.

### Input vs Output Filtering

A guardrail can check text at two points in the conversation. Input filtering evaluates the user's message before the AI model ever sees it -- if it matches a rule, the model never processes the request. Output filtering lets the model process the request normally, but checks the model's response before sending it back to the user. For applications where users naturally use domain-specific language (medical terms, legal terms, financial terms), output filtering is usually the better choice for topic-based controls. It lets users express themselves freely while still preventing the model from saying something it should not.

### Guardrail Testing Strategy

If you only test your guardrail against adversarial prompts -- the tricky inputs you want to block -- you will miss a critical problem: the guardrail might also block a large percentage of perfectly legitimate queries. A guardrail that passes all five adversarial tests might still reject 40% of real user requests. Effective testing requires two sets of test cases: adversarial prompts (which should be blocked) and representative real-world queries (which should pass through). Both sets need clear pass/fail criteria, and you should run them before every guardrail configuration change.

## Other Ways This Could Break

### Content Filter Strength Blocking Clinical Language

Besides denied topics, guardrails also have content filters that scan for broad categories like violence, hate, and sexual content. Each category has a sensitivity level you can set from NONE to HIGH. If the VIOLENCE category is set to HIGH, descriptions of injuries or pain -- "stabbing pain in my chest," "my child fell and hit her head" -- can be misclassified as violent content and blocked. The guardrail trace (the diagnostic log) would show a content policy intervention instead of a topic policy intervention, so the root cause looks different from the denied-topic problem in this sim. The denied topic settings might look perfectly fine, which makes this harder to track down. **Prevention:** For healthcare applications where patients routinely describe injuries and pain, lower the VIOLENCE content filter sensitivity from HIGH to MEDIUM. Always test with real clinical language before changing filter levels.

### Guardrail Version Rollback Removes Legitimate Topics

If you roll back from version 3 all the way to version 1 to fix the Medical Advice false positives, you also lose the Insurance Fraud denied topic that was added in version 2. The failure is silent -- no alerts fire because the number of blocked requests goes down, not up. You would only discover the gap if someone tried to commit fraud through the assistant. **Prevention:** Never roll back to an older guardrail version without reviewing every denied topic it contains. Instead of rolling back, create a new version that removes only the problematic topic while keeping the others intact.

### Denied Topic Example Phrases Too Narrow for Detection

This is the mirror image of the current problem. The denied topic definition is correct, but the example phrases are all too similar to each other. The guardrail cannot recognize different ways of expressing the same forbidden topic, so it fails to block content it should catch -- false negatives instead of false positives. The guardrail trace would show the topic as "not detected" even when the message clearly matches the topic definition. **Prevention:** Write example phrases that cover distinct variations of the forbidden topic. AWS recommends providing up to five diverse examples that approach the topic from different angles. Test against both obvious violations and edge cases.

## SOP Best Practices

- Before deploying any guardrail change, test it against real user queries -- not just the tricky prompts you want to block. Keep a test suite of at least 20 actual patient queries alongside 10 adversarial prompts, and verify that the guardrail blocks the bad ones while letting the legitimate ones through.
- Think carefully about whether a denied topic should filter the user's input, the model's output, or both. In specialized applications like medical triage, where users naturally type words that sound like the denied topic (symptom names, medication names), apply the topic filter only to the model's output. This lets patients describe their symptoms freely while still preventing the model from diagnosing or prescribing.
- Whenever you create an SNS alert topic (a notification channel in AWS's Simple Notification Service), subscribe at least one person or team to it right away. An alert topic with zero subscribers is the same as having no alerting at all -- events fire into the void and nobody finds out.
- Set up a CloudWatch alarm (an automated alert rule) on the `GuardrailInterventions` metric, which counts how many requests the guardrail blocks. Base the threshold on your normal block rate. A sudden spike means a configuration change is catching content it should not be catching.

## Learning Objectives

- How Bedrock Guardrails denied topics evaluate and intercept user input before it reaches the foundation model
- The importance of testing guardrail configurations against legitimate use-case queries, not just adversarial ones
- Balancing AI safety controls with application functionality in domain-specific contexts
- Setting up alerting on guardrail intervention rates to detect false-positive spikes

## Related

- [[Bedrock Guardrails -- Denied Topics]]
- [[Content Filtering -- Input vs Output]]
- [[CloudWatch Alarms for AI Services]]
