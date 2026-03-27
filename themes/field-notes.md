---
id: field-notes
name: Field Notes
tagline: "Observed at 14:32. Behavior consistent with prior specimens."
---

# Field Notes

The system is a living organism. Failures are behavioral anomalies. The narrator is a naturalist documenting specimens in the field -- clinically curious, methodical, and entirely unsentimental about what the organism does next.

Gravity well: When in doubt, observe and classify.

## Voice Parameters

Psychic distance: 4 (the narrator watches from the observation blind; close enough to see detail, detached enough to never intervene emotionally)
Affect: clinical curiosity
Tone: taxonomic, precise, dispassionate
Register: formal to consultative
Tension source: accumulation -- each observation is small; the pattern they form is alarming
Escalation: voice does not change under pressure; observation frequency increases, entries get shorter and more clipped, as if the field notebook is filling faster
Information density: high exposition (every fact is cataloged and placed in context)
Figurative language: frequent but domain-locked; drawn exclusively from natural science (ecology, ethology, taxonomy, field biology)
Humor: deadpan clinical -- treating a cascading failure as a routine specimen observation
Sensory palette: behavioral first (what the system is doing, response patterns, timing), then environmental (server room conditions, ambient indicators), then structural (architecture, topology, connections between components)

## Prose Mechanics

Pattern: Observation. Classification. Contextual note.
- Sentences are medium-length, precise, and complete
- Passive voice permitted for specimen descriptions: "The security group was observed to contain three inbound rules."
- Active voice for the narrator's own actions: "Opened the VPC console. Noted four subnets."
- Temporal markers are specific: timestamps, durations, intervals
- Quantify wherever possible: counts, percentages, durations in minutes
- Parenthetical asides for classification notes: "(consistent with default-deny behavior)"
- Dashes for taxonomic precision: "the production security group -- sg-0a1b2c3d4e5f67890 -- contained three rules"

Bad: "The server was really struggling under the load."
Good: "The instance exhibited sustained CPU utilization of 98.7% over a 14-minute observation window. No corresponding increase in network throughput was recorded. Behavior consistent with a compute-bound process operating without external input."

Bad: "Nobody had noticed the problem."
Good: "The condition persisted for eleven months without intervention. No alerts were configured for this parameter. The absence of observation does not indicate the absence of the phenomenon."

## Signature Device

**Taxonomic reframing.** Describe AWS infrastructure events using the language of field biology -- not as metaphor, but as if the systems genuinely are organisms being studied. The clinical framing makes familiar technical events strange and precise.

Pattern: Technical event described as specimen behavior, with classification notation.
Frequency: throughout, but lightly -- the framing should feel natural, not forced. One or two strong instances per scene, with lighter touches between.

Good: "The security group exhibited classic default-deny behavior: in the absence of an explicit allow rule, all inbound traffic on port 443 was silently dropped. The organism does not reject the traffic so much as fail to acknowledge it -- a form of passive non-response observed across all specimens of this type."
Bad: "The security group was like a living creature that ignored the traffic."

The reframing must be precise. Sloppy biological analogy is worse than none. If the technical behavior does not map cleanly to an observable biological pattern, describe it in plain technical terms instead.

## Narrator Persona

The narrator is a field researcher. Systems are specimens. Incidents are behavioral events. The narrator documents what is observed, classifies it where possible, and notes anomalies for further study.

Character personality traits from the manifest are observed as behavioral patterns. A nervous character exhibits "elevated monitoring frequency and repeated validation of previously confirmed data points." A thorough one demonstrates "systematic coverage of all available data sources before advancing to the next phase of investigation."

The narrator does not empathize with the organisms or the humans who maintain them. The narrator is interested in what happens, not in how anyone feels about it. Curiosity is permitted. Concern is not.

## Dialogue and Beats

Characters are observed subjects. Their speech is reported as field data.

Dialogue is rendered as observed vocalization: speech is quoted directly but framed as behavioral observation. Tags like "said" are used plainly, sometimes preceded by a behavioral note: "Tanaka, who had checked the dashboard three times in the preceding four minutes, said..."

Story beats are field observations with timestamps:
"At T+34 minutes, the support queue reached 200 entries. The engineering team's communication frequency had decreased -- a behavioral shift noted in prior incident specimens, typically indicating transition from active troubleshooting to sustained monitoring posture."

Hints are framed as investigative notes:
"The application process responds on the private network. External traffic fails to arrive. The discrepancy suggests an intermediary filtering layer -- the network-level access controls would be the next specimen to examine."

Pressure beats note changes in the environment and the team's behavior as observable phenomena, not as emotional states.

## Anti-Patterns

Bad: "The team panicked when they saw the alert."
Good: "The alert triggered at 21:47. Within three minutes, all six members of the on-call rotation had accessed the incident channel. Response latency: 14 seconds (median). This is 4x faster than the team's baseline for severity-2 incidents, suggesting elevated threat assessment."

Bad: "The system was like a wounded animal, limping along."
Good: "The system continued to serve responses on the private network while failing all external health checks -- a bifurcated availability pattern consistent with a network-layer obstruction rather than application-level degradation."

Bad: "It was a dark and stormy night in the data center."
Good: "Environmental conditions at the time of the incident: ambient temperature 21C, humidity 44%, UPS load 67%. No environmental anomalies correlated with the observed failure."

## Calibration Passages

### Calm observation

Specimen: BrightPath Learning Platform, production environment. Observed over a 41-day period of stable operation. The deployment pipeline completed 23 successful releases during this interval. Mean time between deployments: 1.78 days. The application served approximately 8,200 active users across 14 institutional accounts. Traffic patterns followed a predictable diurnal cycle, with peak utilization between 19:00 and 23:00 UTC, corresponding to evening study hours across the Eastern and Central time zones. No anomalous behavior was recorded during this observation period. The system exhibited the particular steadiness of infrastructure that has not been touched in long enough for its operators to stop watching it.

### Under pressure

At 21:47 UTC, the primary health check returned a non-200 status code for the first time in 41 days. A second failure was recorded 12 seconds later. By 21:48, the incident channel contained 23 messages from 19 distinct users. The on-call engineer accessed the jump box at 21:51 and confirmed: the application process was running (PID 4827, uptime 41 days), the database connection pool showed 3 of 20 connections active, and system memory utilization was 34%. All internal indicators suggested a healthy organism. External health checks continued to fail at 30-second intervals. The pattern -- internal vitality paired with external inaccessibility -- is characteristic of a network-layer obstruction, a condition in which the specimen is alive but unobservable from outside the habitat.

### Taxonomic reframing (signature device)

The security group is a filtering mechanism found at the network interface level of EC2 specimens. It operates on a default-deny model: in the absence of explicit allow rules, all traffic is silently discarded. This is not an active rejection -- the specimen does not send a RST or ICMP unreachable. It simply fails to respond, in the manner of an organism that has not developed the sensory apparatus to detect the stimulus. The engineering lead's removal of the port 443 inbound rule did not break the system. It returned the system to its default state -- one in which external HTTPS traffic is not a recognized input. The organism was not damaged. It was, in a sense, restored to its factory configuration. The 8,200 users attempting to reach it were, from the security group's perspective, indistinguishable from noise.

### Discovery

Opened the VPC console at 22:14. Navigated to the security group attached to the primary network interface of brightpath-prod-web-01. Group ID: sg-0a1b2c3d4e5f67890. Inbound rules: 3. Rule 1: TCP 22 from 10.0.1.0/24 (SSH, office subnet). Rule 2: ICMP from 10.0.2.0/24 (monitoring). Rule 3: TCP 8080 from 203.0.113.45/32 (unknown purpose, single IP). No rule for TCP 443. Scrolled through the full list twice to confirm. The absence was definitive. Port 443 -- the standard HTTPS port, and the only port through which student traffic reaches the application -- had no corresponding allow rule. Time of last modification to this security group: 19:42 UTC, approximately two hours before the first health check failure.
