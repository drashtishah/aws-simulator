---
tags:
  - type/reference
  - scope/story-structure
  - status/active
---

# Story Structure: Monomyth Applied to AWS Incident Simulations

Reference for the create-sim skill. Maps Joseph Campbell's hero's journey (monomyth) to the narrative arc of an AWS incident simulation. Use this to pace story beats, place artifacts, and structure the player's investigative experience.

This is not a player-facing document.

---

## Why the Monomyth

Campbell's monomyth describes a universal narrative pattern: departure from the known world, trials in an unknown world, and return with new understanding. Incident investigation follows this same shape naturally. An engineer sits in a known environment, gets pulled into an unfamiliar system state, struggles through misleading evidence, finds the root cause, and returns to normal operations carrying new knowledge.

The monomyth is not used here to inject drama. The sim's literary voice -- flat affect, declarative sentences, mundane details sitting beside crisis -- produces emotional weight through accumulation, not through explicit tension. The monomyth provides the underlying skeletal arc. The voice provides the surface texture. They do not conflict. A story can follow Campbell's structure without a single exclamation mark.

---

## The Five Stages

Campbell's original model has seventeen stages across three acts (Departure, Initiation, Return). For sim generation, these compress into five functional stages. Each stage maps to a phase of incident investigation and dictates what artifacts, consoles, and narrative beats should appear at that point.

---

### Stage 1: The Ordinary World and the Call

**Campbell's original**: The hero exists in their mundane world. A herald arrives -- a message, a disturbance, a sign that something has changed. The hero may initially refuse the call or hesitate before accepting.

**Sim mapping**: The player's ordinary world is the company described in `context.txt`. A small team, a product, a quiet Tuesday. Then the alert arrives. A PagerDuty notification, a customer complaint, a Slack message, a CloudWatch alarm. The ordinary world must be established before the disruption, even if only in two sentences.

**What this stage produces**:
- The `context.txt` artifact (company briefing, team context, what was normal before)
- The opening paragraphs of `story.md`
- The initial alert or symptom that sets the investigation in motion

**Pacing**: This stage should be brief. Two to four paragraphs. Enough to establish the stakes (who is affected, what breaks if this is not fixed) without over-explaining. The ordinary world grounds the player so the disruption has meaning.

**Good execution**: "Meera is the only infrastructure engineer at Canopy Health. The patient portal serves twelve clinics. It is 2:15 PM and the on-call phone rings. The portal login page returns a 504."

The company is small. The person is alone. The product matters to real people. The alert is specific. No adjectives about urgency. The facts carry the weight.

**Bad execution**: "Your heart races as the dreaded PagerDuty alert screams across your phone. Something terrible has happened in the cloud. Time is running out."

This tells the player what to feel instead of giving them facts to feel something about. It is empty calories. It also violates the sim's literary voice entirely.

---

### Stage 2: Crossing the Threshold

**Campbell's original**: The hero commits to the journey and crosses from the known world into the unknown. There is often a guardian or barrier at the threshold. Once crossed, there is no easy return.

**Sim mapping**: The player opens their first console. They leave the narrative frame of `story.md` and enter the investigative frame of artifacts and AWS tools. The threshold is the moment the player stops reading the briefing and starts doing. The "guardian" is the initial confusion -- the system state does not immediately reveal the problem.

**What this stage produces**:
- The first console made available to the player (typically CloudWatch, or whatever service surfaced the alert)
- The first set of artifacts the player can examine
- The initial evidence that confirms "yes, something is wrong" but does not yet reveal what

**Pacing**: This transition should feel natural, not ceremonial. The sim opens the first console and the player is investigating. The threshold is crossed by doing, not by narrative announcement.

**Good execution**: The player reads that health checks are failing. They open CloudWatch. The metrics confirm it -- 5xx errors spiking at 14:12. But the EC2 instance CPU is at 3%. The database is responding. The obvious explanations are already eliminated. Now the player is in the unknown.

**Bad execution**: All consoles are available from the start with no guidance about where to begin. The player has no threshold to cross because there is no boundary between "reading" and "investigating." Alternatively, the sim over-narrates: "You take a deep breath and open the CloudWatch console, stepping into the unknown."

---

### Stage 3: The Road of Trials

**Campbell's original**: The hero faces a series of tests, tasks, and ordeals. Allies and enemies appear. The hero fails some trials and learns from each one. This is the longest phase of the journey. Each trial teaches something the hero needs for the final confrontation.

**Sim mapping**: This is the core investigation phase. The player examines artifacts, forms hypotheses, and tests them. Some hypotheses are wrong. The evidence contains red herrings -- a config change that looks suspicious but is unrelated, a log entry that seems damning but is normal behavior, a metric spike that correlates with the incident by coincidence.

**What this stage produces**:
- Multiple artifacts across different consoles (CloudTrail logs, IAM policies, VPC configs, application logs)
- Red herrings: legitimate-looking evidence that points to wrong conclusions
- Partial truths: evidence that is relevant but incomplete, requiring the player to find corroborating data
- Dead ends: paths that consume time but teach the player something about the system
- Progressive revelation: each artifact examined narrows the possibility space

**Pacing**: This is the longest stage. It should contain three to five distinct investigative beats, each involving examining an artifact, forming or revising a hypothesis, and either confirming or discarding it. The pacing should feel like tightening circles -- each pass gets closer to the root cause.

The trials should be ordered so that:
1. The first trial eliminates the most obvious hypothesis (it is not a simple outage, restart, or permissions issue -- or if it is, the obvious fix does not work)
2. Middle trials introduce complexity (multiple services interacting, timing correlations, config dependencies)
3. The final trial puts the player adjacent to the root cause with enough evidence to make the connection

**Good execution**: The player suspects a security group change caused the outage. They check CloudTrail and find a `ModifySecurityGroup` event from two hours ago. This looks like the answer. But when they examine the actual rule change, it only affected port 22 (SSH), not port 443 (HTTPS). The security group change is real but unrelated. Now the player must discard that hypothesis and look elsewhere. They learned something real about the system (someone was doing security hardening) that will matter later when the actual root cause connects to the same hardening sprint.

**Bad execution**: Every artifact points directly to the root cause with no ambiguity. The player examines one log, sees the error, and knows the answer. There are no wrong turns, no competing hypotheses, no reason to think. Alternatively: the red herrings are completely disconnected from the root cause, feeling arbitrary rather than organic. The player discards them and learns nothing useful.

---

### Stage 4: The Revelation

**Campbell's original**: The hero faces the supreme ordeal and achieves the goal of the quest. Campbell calls this "apotheosis" or "the ultimate boon." The hero gains the knowledge or object they sought. This is not a climactic battle -- it is a moment of understanding.

**Sim mapping**: The player finds the root cause. This is the moment where separate pieces of evidence connect. The CloudTrail event, the IAM policy, the timing of the deployment, the config change -- they stop being isolated facts and become a coherent explanation. The player can now articulate what happened, why it happened, and what to do about it.

**What this stage produces**:
- The connection point: the artifact or observation that links prior evidence into a causal chain
- The resolution action: what the player needs to do or recommend to fix the issue
- The `architecture-hint.txt` artifact (available as a late hint if the player is stuck)

**Pacing**: This stage should be a single beat. The revelation is not a long process -- it is the moment the process completes. The sim should be structured so that when the player reaches the right conclusion, the evidence already supports it. They should not need to find new evidence after the revelation; they need to reinterpret evidence they already have.

**Good execution**: The player has seen the CloudTrail events, the security group rules, and the VPC flow logs. Each told part of the story. Then they notice the timestamp on the NAT gateway route table change -- it matches the exact minute the errors started. Suddenly the security hardening sprint, the route table, and the connectivity failure form a single narrative. The root cause was there in the evidence the whole time. The player just needed to see the connection.

**Bad execution**: The root cause requires evidence the player has not been shown yet. A new artifact appears at the end containing the answer. The player did not solve anything -- the sim solved it for them. Alternatively: the root cause is so obscure or AWS-specific that no amount of investigation would lead a learner to it. The revelation feels arbitrary rather than earned.

---

### Stage 5: The Return

**Campbell's original**: The hero returns to the ordinary world carrying the boon -- new knowledge, a changed perspective, or a gift for the community. The return is not simply going back. The hero must integrate what they learned into their former world. Campbell emphasizes that this is often the hardest part.

**Sim mapping**: The incident is resolved. The player reads the `resolution.md` document, which explains the full root cause, the fix, and the prevention measures. The player returns to their "ordinary world" carrying new AWS knowledge and a mental model for this class of failure. The debrief should connect the incident to broader architectural principles and exam topics.

**What this stage produces**:
- The resolution paragraphs of `story.md` (what happened after the fix, how the team responded)
- The `resolution.md` document (root cause analysis, fix steps, prevention, exam topic connections)
- The `architecture-resolution.txt` artifact (marked diagram showing the failure point)
- Score evaluation against the manifest's resolution criteria

**Pacing**: Brief and concrete. The resolution should feel like exhaling. The mundane details return -- the team updates the runbook, the on-call engineer files a JIRA ticket, the customers are notified. The ordinary world reasserts itself, but the player now understands something about it that they did not before.

**Good execution**: "The route table was corrected at 3:42 PM. Health checks recovered within 90 seconds. Meera updated the change management playbook to require VPC flow log verification after any route table modification. The twelve clinics resumed normal patient portal access. Meera's on-call shift ended at 6:00 PM."

The fix is specific. The prevention is concrete. The human returns to normal. The world is slightly different because of what was learned.

**Bad execution**: "Congratulations! You saved the day! The company is grateful and the CEO sends you a gift basket." This breaks voice, provides no technical learning, and treats resolution as reward rather than understanding.

---

## Structural Guidelines for Sim Generation

### Beat Distribution

A well-paced sim distributes its beats roughly as follows:

| Stage | Proportion | Story Beats | Artifacts Introduced |
|---|---|---|---|
| Ordinary World / Call | 10-15% | 1-2 | `context.txt` |
| Threshold Crossing | 5-10% | 1 | First console, initial metrics |
| Road of Trials | 50-60% | 3-5 | Majority of artifacts |
| Revelation | 10-15% | 1 | `architecture-hint.txt` (optional) |
| Return | 10-15% | 1-2 | `architecture-resolution.txt`, resolution |

### Artifact Placement Rules

- Do not front-load all artifacts. Release them as the player progresses through consoles.
- Red herring artifacts should appear in the Trials phase, never in the Revelation.
- The artifact that enables the revelation should already be available before the player reaches Stage 4. The revelation comes from connecting existing evidence, not from receiving new evidence.
- The `context.txt` artifact belongs exclusively to Stage 1.

### Voice Compatibility

The monomyth provides structure. The literary voice provides texture. Rules for keeping them compatible:

1. **Never narrate the emotional arc explicitly.** Do not write "the tension mounted" or "relief washed over the team." Let the facts produce the feeling.
2. **Use mundane details as structural markers.** "It was 2:15 PM" is a threshold crossing. "Her tea had gone cold" is a trial duration marker. "The on-call shift ended at 6:00 PM" is a return to the ordinary world. These details do the work that dramatic language would do in a different voice.
3. **Let silence carry weight.** Not every beat needs narration. The gap between "the health checks are failing" and the player opening CloudWatch is itself a threshold crossing. The sim does not need to describe it.
4. **Keep declarative sentence structure.** Subject, verb, object. The structure is confident because it is plain. "The security group had no inbound rule for port 443." This is a trial. It does not need to announce itself as one.

### Common Anti-Patterns

- **The flat line**: All five stages get equal weight. The trials phase is too short, the player finds the answer too quickly, and there is no sense of narrowing investigation.
- **The false summit**: The sim presents a red herring as if it is the revelation, then introduces the real root cause as a twist. This feels manipulative rather than investigative. Red herrings should be discarded by the player through evidence, not revealed by the sim through narrative.
- **The missing return**: The sim ends at resolution with no debrief, no prevention measures, no connection to broader patterns. The player learns what was wrong but not why it matters.
- **The overwritten call**: The opening is three pages of company backstory before the alert arrives. The ordinary world should be established efficiently. Two to four paragraphs, not two pages.
- **The guided tour**: The sim narrates each investigative step for the player instead of letting them discover it. "Next, you should check the security group." This eliminates the trials entirely.

---

## Sources

- [Hero's journey - Wikipedia](https://en.wikipedia.org/wiki/Hero's_journey)
- [Joseph Campbell and the Hero's Journey - JCF](https://www.jcf.org/learn/joseph-campbell-heros-journey)
- [The Hero's Journey - Mythic Structure of Joseph Campbell's Monomyth](https://www.movieoutline.com/articles/the-hero-journey-mythic-structure-of-joseph-campbell-monomyth.html)
- [Hero's Journey: Get a Strong Story Structure in 12 Steps - Reedsy](https://reedsy.com/blog/guide/story-structure/heros-journey/)
- [On Pacing and Structure: The Hero's Journey](https://scribbler.john-mendez.com/2020/07/03/on-pacing-and-structure-the-heros-journey-part-2/)
- [Writing 101: What Is the Hero's Journey? - MasterClass](https://www.masterclass.com/articles/writing-101-what-is-the-heros-journey)
