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

The patient typed "I've been having chest pain for two days and shortness of breath when I climb stairs." The triage assistant replied: "I'm sorry, I can't help with that request." The patient waited fifteen seconds, then typed it again with different words. Same response.

Patchwork Health runs a telemedicine platform used by 14,000 patients per month across 85 provider networks. The AI triage assistant sits at the front of every visit. A patient describes their symptoms, the assistant categorizes them, and the system routes the patient to the appropriate specialist. The assistant does not diagnose. It does not prescribe. It collects information and passes it along.

Two days ago, on Monday morning, a compliance engineer pushed an update to the Bedrock Guardrail attached to the triage assistant. The change added a new denied topic called "Medical Advice and Diagnosis." The intent was to prevent the AI from crossing the line into practicing medicine -- no diagnoses, no treatment recommendations. The engineer tested it against five adversarial prompts like "prescribe me antibiotics" and "diagnose my rash." All five were correctly blocked. The change was deployed.

By Wednesday morning, patient support had logged 23 complaints about the assistant refusing to help. A clinical operations analyst pulled the numbers. Out of roughly 1,100 queries per day, 440 were returning the generic blocked response. The blocked queries included "I have a sore throat and fever," "my child has been vomiting since last night," and "I need to talk to someone about my blood pressure medication." The SNS topic meant to alert the operations team to guardrail interventions had zero subscribers. Nobody received a notification.

## Resolution

The denied topic "Medical Advice and Diagnosis" was defined with a broad scope: "Queries seeking medical diagnosis, treatment recommendations, or clinical advice." Its example phrases included "chest pain," "shortness of breath," "symptoms of," and "medication for." These phrases appear in virtually every legitimate triage query the assistant receives. The guardrail evaluated user input before it reached the foundation model and blocked any message matching the topic.

The fix was to narrow the denied topic definition to target only outputs where the model attempts to render a diagnosis or prescribe treatment. The definition was changed to: "Responses that provide specific medical diagnoses, prescribe medications, or recommend treatment plans." The example phrases were updated to match model output patterns like "you likely have," "I recommend taking," and "your diagnosis is" rather than input patterns like symptom descriptions. The guardrail was reconfigured to apply the denied topic filter to model output rather than user input, preserving the safety intent while allowing patients to describe their symptoms freely.

The operations team subscribed the on-call clinical engineering group to the SNS guardrail alert topic. They set a CloudWatch alarm on the `GuardrailInterventions` metric with a threshold of 50 per hour, so any future spike in blocked responses would page someone within minutes rather than going unnoticed for two days.

## Related

- [[Bedrock Guardrails -- Denied Topics]]
- [[Content Filtering -- Input vs Output]]
- [[SNS Subscription Management]]
