---
tags:
  - type/reference
  - scope/play-skill
  - status/active
---

# Coaching Patterns

Pattern analysis rules for post-simulation coaching feedback and knowledge score updates. The play skill reads this file after the player resolves a simulation.

---

## Investigation Patterns to Track

During the simulation, the Narrator's session state captures the player's behavior. After resolution, analyze the session state to identify these patterns:

### 1. First Action Taken

What did the player check first?

| First action | Signal |
|---|---|
| Logs (CloudWatch, application logs) | Log-first thinker -- good instinct for timeline reconstruction |
| Permissions (IAM, bucket policies, security groups) | Security-first thinker -- good for security incidents |
| Architecture (asks about infrastructure layout) | Systems thinker -- understands context before diving in |
| Metrics (CloudWatch metrics, dashboards) | Data-driven investigator -- looks for quantitative signals |
| Recent changes (CloudTrail, deployment history) | Change-aware investigator -- looks for causation |
| Guessed a fix immediately | Premature fixer -- needs coaching on investigation discipline |

### 2. Investigation Breadth

- How many different service consoles did the player query?
- Did they query services outside the direct incident scope?
- Did they correlate data across multiple services?

### 3. Investigation Depth

- How many questions did the player ask before proposing a fix?
- Did they ask follow-up questions after receiving initial data?
- Did they request specific operations or just ask vague questions?

### 4. Audit Trail Awareness

- Did the player check CloudTrail or equivalent audit logs?
- Did they try to establish a timeline of changes?
- Did they identify WHO made the change, not just WHAT changed?

### 5. Blast Radius Consideration

- Did the player ask about the scope of impact before proposing a fix?
- Did they consider what else might be affected?
- Did they ask about downstream dependencies?

### 6. Monitoring Awareness

- Did the player ask about existing alarms or monitoring?
- Did they ask why the issue was not detected sooner?
- Did they suggest monitoring improvements as part of remediation?

### 7. Recent Changes Pattern

- Did the player ask about recent deployments or configuration changes?
- Did they correlate the incident timeline with change events?

### 8. Debrief Engagement

- How many questions did the player ask during the debrief Q&A? (`debrief_questions_asked`)
- How many content zones did they explore? (`debrief_zones_explored`)
- Did they ask follow-up or depth questions -- "why", "what if", cross-referencing concepts? (`debrief_depth_score`)
- Did they skip the debrief entirely?

---

## Coaching Feedback Rules

Generate specific, actionable feedback based on the patterns observed. Each rule has a condition and a response. Apply ALL matching rules.

### Negative Patterns (areas for improvement)

**Never checked logs:**
Condition: "cloudwatch" or equivalent log service not in services_queried AND no log-related questions in investigation
Feedback: "Consider starting with CloudWatch logs next time -- they often contain the first clue about when things started going wrong. Logs establish the timeline and narrow down which component is misbehaving."

**Jumped straight to fix without investigation:**
Condition: questions_asked < 4 before first fix proposal
Feedback: "You proposed a fix after only {questions_asked} questions. Take time to investigate the root cause -- fixing symptoms without understanding the cause leads to recurrence. Aim to understand WHAT happened, WHEN it happened, and WHY before proposing HOW to fix it."

**Only checked one service:**
Condition: len(services_queried) == 1 AND len(manifest.services) > 1
Feedback: "This incident involved {comma-separated manifest.services}. Broadening your investigation to related services would have uncovered the connection faster. AWS incidents rarely involve a single service in isolation."

**Never checked CloudTrail / audit trail:**
Condition: "cloudtrail" not in services_queried AND no questions about "who changed", "when was it modified", "API calls", or "event history"
Feedback: "CloudTrail records all API calls in your AWS account. Checking it early helps establish a timeline of what changed and when. In a real incident, the first question is often 'what changed recently?' -- CloudTrail answers that."

**Never asked about architecture:**
Condition: Player never queried the architecture diagram or asked about how services connect
Feedback: "Understanding the architecture before diving into details helps you see the full picture. Knowing how services connect reveals which components could be affected and where to focus your investigation."

**Never considered blast radius:**
Condition: No questions about scope, impact, affected users, or downstream effects
Feedback: "Before proposing a fix, consider the blast radius -- how many users, services, or systems are affected? Understanding scope helps you prioritize containment and communicate impact to stakeholders."

**Never asked about monitoring/alerting:**
Condition: No questions about alarms, monitoring, dashboards, or detection
Feedback: "Asking why existing monitoring did not catch this sooner is a senior engineer habit. It turns every incident into an opportunity to improve detection and reduce future mean-time-to-detect."

**Never asked about recent changes:**
Condition: No questions referencing deployments, recent modifications, config changes, or "what changed"
Feedback: "Most AWS incidents are caused by recent changes -- deployments, configuration updates, or policy modifications. Asking 'what changed recently?' is one of the highest-value first questions in incident response."

**Used all hints:**
Condition: hints_used == len(narrator.hints)
Feedback: "You needed all {hints_used} hints to reach the root cause. That is okay for learning, but in a real incident there are no hints. Practice building a systematic investigation checklist: logs, metrics, changes, permissions, architecture."

### Positive Patterns (reinforcement)

**Strong first action:**
Condition: First action was checking logs, CloudTrail, or recent changes
Feedback: "Strong opening move -- you checked {first_action} before jumping to conclusions. That methodical approach is exactly what senior engineers do in incident response. It establishes context before you start forming hypotheses."

**Broad investigation:**
Condition: len(services_queried) >= len(manifest.services) - 1
Feedback: "Good investigation breadth -- you checked {comma-separated services_queried}, covering the full scope of the incident. Correlating data across services is how you find root causes that span infrastructure boundaries."

**Asked about blast radius:**
Condition: Player asked about scope, affected users, or impact before proposing fix
Feedback: "Smart to assess the blast radius before proposing a fix. Understanding scope helps you prioritize: contain the damage first, then fix the root cause, then prevent recurrence."

**Checked audit trail early:**
Condition: CloudTrail or audit-related questions in the first 3 questions
Feedback: "Checking CloudTrail early is a strong instinct. In real incidents, the audit trail often contains the single most important clue: what changed, when, and who did it."

**Thorough investigation before fix:**
Condition: questions_asked >= 6 AND all required criteria met on first fix proposal
Feedback: "Thorough investigation -- you asked {questions_asked} questions and nailed the root cause on your first fix proposal. That discipline of gathering evidence before acting is what separates incident commanders from firefighters."

**Asked excellent diagnostic questions:**
Condition: Player asked specific, targeted questions that directly advanced the investigation (judge from investigation_summary)
Feedback: "Your question about {specific_question_example} was particularly effective -- it went straight to the heart of the issue. Asking precise, targeted questions reduces noise and gets you to root cause faster."

### Debrief Engagement

**Curious investigator (positive):**
Condition: debrief_questions_asked >= 4 AND len(debrief_zones_explored) >= 3
Feedback: "You dug into the debrief -- asked {debrief_questions_asked} questions across {comma-separated debrief_zones_explored}. That curiosity is the same instinct that drives good incident postmortems."

**Systems thinker (positive):**
Condition: debrief_depth_score >= 3
Feedback: "Your debrief questions went beyond 'what happened' into 'what else could happen' and 'how do the pieces connect.' That is systems thinking -- the skill that separates someone who fixes incidents from someone who prevents them."

**Skipped debrief (negative):**
Condition: debrief_questions_asked == 0
Feedback: "You skipped the debrief. The resolution is where the learning happens -- not the incident itself. Next time, try asking at least one question about how to prevent recurrence or what else could break."

**Surface engagement (neutral):**
Condition: debrief_questions_asked >= 2 AND debrief_depth_score < 2
Feedback: "You asked questions during the debrief. Try pushing deeper next time: after learning what happened, ask why it was possible, and what would catch it earlier."

---

## Knowledge Score Update Rules

After the simulation, update `learning/catalog.csv` for each service involved in the sim.

### Scoring Criteria

For each service in `manifest.services`, award points based on the player's interaction:

| Action | Points | Condition |
|---|---|---|
| Asked relevant questions about the service | +1 | Player queried the service console AND asked at least 1 question that returned useful data |
| Correctly identified an issue in the service | +1 | Player identified a misconfiguration, anomaly, or root cause component in this service |
| Demonstrated config understanding | +1 | Player showed understanding of service-specific configuration (e.g., knew what a bucket policy Principal field means, understood security group rules, recognized CloudTrail event structure) |

### Scoring Constraints

- **Cap: +2 per sim per service.** Even if the player scores +3 on the criteria above, record only +2. This prevents a single simulation from inflating scores.
- **Minimum: +0.** If the player never interacted with a service console, that service gets no score change.
- **No negative scores.** Do not reduce knowledge_score based on poor performance. The score represents exposure and understanding, not perfection.

### Catalog CSV Update Format

For each service in `manifest.services`, update these columns in `learning/catalog.csv`:

| Column | Update rule |
|---|---|
| `knowledge_score` | Add the points awarded (respecting the +2 cap). Do not exceed the maximum meaningful score. |
| `sims_completed` | Increment by 1 |
| `last_practiced` | Set to today's date (ISO 8601, date only: YYYY-MM-DD) |
| `notes` | Append a brief observation about the player's interaction with this service. Format: "{sim_id}: {observation}". If notes already exist, append with semicolon separator. |

### Example Notes

Good notes are specific and reference what the player actually did:

- `001-s3-bucket-breach: identified Principal:* in bucket policy, understood resource-based vs identity-based policy difference`
- `001-s3-bucket-breach: queried CloudTrail but did not correlate PutBucketPolicy timestamp with incident timeline`
- `001-s3-bucket-breach: did not query this service`

Bad notes are vague or generic:

- `completed sim` (says nothing useful)
- `good job` (not actionable)
- `needs improvement` (no specifics)

---

## Profile Update Rules

After scoring, update `learning/profile.json`:

### Weakness Detection

Add a service to `weaknesses` if:
- The player never queried that service's console during a sim where it was involved
- The player scored 0 points for that service in this sim
- The service is already in weaknesses and the player did not improve this sim

Remove a service from `weaknesses` if:
- The player scored +2 for that service in this sim
- The player demonstrated clear understanding during investigation

### Strength Detection

Add a service to `strengths` if:
- The player scored +2 for that service AND correctly identified the issue on first attempt
- The player asked expert-level diagnostic questions about the service

### Question Pattern Tracking

Update `question_patterns` with what the player tends to check first and most often. Structure:

```json
{
  "first_action_frequency": {
    "logs": 0,
    "permissions": 0,
    "architecture": 0,
    "metrics": 0,
    "recent_changes": 0,
    "immediate_fix": 0
  },
  "avg_questions_before_fix": 0,
  "audit_trail_check_rate": 0.0,
  "multi_service_investigation_rate": 0.0
}
```

Update these counters after each sim to build a picture of the player's investigation tendencies over time.

---

## Related

- [[SKILL]] -- Play skill workflow that triggers coaching analysis
- [[agent-prompts]] -- Consolidated prompt template (Narrator Mode + Console Mode)
- [[learning/catalog.csv]] -- Player service progress
- [[profile.json]] -- Learner profile with patterns and progression
