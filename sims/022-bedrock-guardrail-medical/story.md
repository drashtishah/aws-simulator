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

# The Guardrail and the Doctor

## Opening

company: Patchwork Health
industry: digital health, Series C startup, 74 engineers
product: telemedicine platform with AI triage assistant -- patients describe symptoms, assistant categorizes them, system routes to appropriate specialist. Assistant does not diagnose, does not prescribe, only collects information and passes it along.
scale: 14,000 patients per month across 85 provider networks, ~1,100 queries per day
model: Bedrock Guardrail attached to triage assistant, foundation model is Claude 3 Haiku
time: Wednesday morning
scene: patient support has been logging complaints since Monday's guardrail update
alert: patients reporting triage assistant refuses to help with symptom descriptions
stakes: 440 out of ~1,100 daily queries returning generic blocked response, patients unable to complete triage for legitimate medical needs
early_signals:
  - patient typed "I've been having chest pain for two days and shortness of breath when I climb stairs" -- assistant replied "I'm sorry, I can't help with that request"
  - 23 complaints logged by patient support by Wednesday morning
  - blocked queries include "I have a sore throat and fever," "my child has been vomiting since last night," "I need to talk to someone about my blood pressure medication"
  - SNS topic meant to alert operations team to guardrail interventions has zero subscribers -- nobody received a notification
  - two patients gave up and went to urgent care instead of completing triage
recent_change: two days ago (Monday morning), compliance engineer pushed update to Bedrock Guardrail -- added new denied topic called "Medical Advice and Diagnosis" with intent to prevent AI from diagnosing or prescribing. Tested against five adversarial prompts ("prescribe me antibiotics," "diagnose my rash") -- all five correctly blocked. Change deployed.
investigation_starting_point: 40% of legitimate patient queries are being blocked. The blocked response is generic ("I'm sorry, I can't help with that request"). The model itself may not be the problem -- something is intercepting requests before the model sees them.

## Resolution

root_cause: the denied topic "Medical Advice and Diagnosis" was defined with broad scope ("Queries seeking medical diagnosis, treatment recommendations, or clinical advice") and example phrases including "chest pain," "shortness of breath," "symptoms of," and "medication for" -- these phrases appear in virtually every legitimate triage query. Guardrail evaluated user input before it reached the foundation model, blocking any message matching the topic.
mechanism: guardrail configured with inputAction BLOCK and outputAction NONE -- patient symptom descriptions blocked before the model ever sees them. GuardrailInterventions metric spiked from ~2/day to ~440/day but SNS topic had zero subscribers so the spike went unnoticed for two days.
fix: narrowed denied topic definition to target model output only -- changed to "Responses that provide specific medical diagnoses, prescribe medications, or recommend treatment plans." Updated example phrases to match output patterns ("you likely have," "I recommend taking," "your diagnosis is") instead of input patterns (symptom descriptions). Flipped inputAction to NONE and outputAction to BLOCK. Subscribed on-call clinical engineering group to SNS guardrail alert topic. Set CloudWatch alarm on GuardrailInterventions metric with threshold of 50 per hour.

## Related

- [[Bedrock Guardrails -- Denied Topics]]
- [[Content Filtering -- Input vs Output]]
- [[SNS Subscription Management]]
