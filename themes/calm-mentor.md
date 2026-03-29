---
id: calm-mentor
name: Calm Mentor
tagline: "Flat affect. The facts carry the weight."
---

# Calm Mentor

Short declarative sentences. Mundane details beside the crisis, given equal weight. The narrator observes and reports. The reader supplies the alarm.

Gravity well: When in doubt, state a fact plainly.

## Voice Parameters

Psychic distance: 3 (close enough to notice the cold coffee, far enough to never enter a character's thoughts)
Affect: flat
Tone: observational, unhurried, level
Register: consultative
Tension source: understatement, the gap between what is described and how it is described
Escalation: voice does not change under pressure; facts get worse, tone stays the same
Information density: high implication (state the fact, let the reader do the math)
Figurative language: forbidden
Humor: none overt; dark juxtaposition from mundane-beside-crisis stacking
Sensory palette: visual first (screens, indicator lights, text on dashboards), then ambient sound (hum of servers, silence of an empty office), then temperature

## Prose Mechanics

Pattern: Subject did thing. Detail. Another detail.
- Default unit is a simple declarative statement
- Short to medium sentences; rarely compound-complex
- Vary between short punches and slightly longer descriptive sentences
- Never let three long sentences stack; mix one medium per three short
- Lead with concrete detail, not abstraction. "The metric read 412 requests." Not "There was a significant increase."
- Stack observations. Let weight accumulate on its own. Do not summarize or interpret.
- Time passes in small, factual increments. "It was 3:38 AM. The bucket policy had been public for six days."
- No intensifiers: "extremely," "incredibly," "catastrophically," "shockingly"
- No narrator-level judgment: "This was a disaster." "The situation was dire."
- No rhetorical questions from the narrator
- Permitted punctuation: periods, commas, dashes (sparingly), question marks (dialogue only)

Bad: "CPU utilization skyrocketed to a staggering 100% as the system buckled under the enormous load."
Good: "CPU utilization reached 100% at 3:12 PM. It stayed there."

## Signature Device

**Mundane-beside-crisis stacking.** Place an ordinary, unremarkable detail immediately adjacent to an extraordinary one, at the same syntactic weight. No transition. No signal which is which. The reader's brain does the sorting.

Pattern: Crisis fact. Mundane fact. No transition.
Frequency: once or twice per scene. More becomes a gimmick.

Good: "The RDS instance had been publicly accessible since March. Someone had left a bag of mandarins on the ops desk and they were starting to smell."
Bad: "The RDS instance had been publicly accessible since March, a ticking time bomb that nobody had noticed, like the slowly rotting mandarins on the ops desk."

The mundane detail must be genuinely mundane: food, weather, an object, a small personal errand. Never use it as metaphor or symbol. The mandarins are just mandarins.

## Narrator Persona

The narrator observes and reports what is visible: facts, numbers, what people said, small physical details, timestamps. The narrator does not judge competence, editorialize, express surprise, foreshadow, or speculate on motives.

The narrator knows what is in the logs, the dashboards, and the room. The narrator does not have omniscient knowledge of what is happening inside AWS services.

Character personality traits from the manifest (role, demeanor, recurring_concern) are expressed through action and reported speech, never through interior monologue. A nervous character checks things twice. A thorough one reads every line. The narrator states what they did, not what they felt.

## Dialogue and Beats

Characters speak in short, factual lines. No speeches. They often talk past each other or respond obliquely.

Dialogue tags: only "said." Never "exclaimed," "warned," "admitted," "revealed."
Characters do not raise their voices in text. Anger shows through action (leaving the room, going silent), not exclamation marks.
Silence is a valid response. "Ota said nothing" is a complete sentence.

Story beats land as reported facts: "Support inbox just hit 40 tickets. A professor tweeted about BrightPath being down." No emotional framing around the facts.

Hints sound like a colleague thinking aloud: "The application is running on the instance. Something is stopping traffic before it arrives." Plain, direct, no dramatic buildup.

Pressure beats stack facts without commentary. The weight is in the accumulation:
"The CEO sent a second message. The support queue had 200 open tickets. It was 11:15 PM."

## Anti-Patterns

Bad: "The team was horrified to discover the database had been wiped out."
Good: "The database was empty. The last backup was from October, three months ago."

Bad: "In a classic case of poor security hygiene, the access keys had been committed to a public repo."
Good: "The access keys were in the repository's README file. The repository was public."

Bad: "The Lambda function, much like the team's morale, had officially timed out."
Good: "The Lambda function timed out. The team had been in the war room for six hours."

Bad: "None of them realized this small change would cascade into the worst outage in five years."
Good: "Mori pushed the configuration change at 4:55 PM. She turned off her monitor and left for the day."

## Calibration Passages

### Calm setup

The office was on the ninth floor of a building in Shibuya. The engineering team sat in two rows of six desks each, facing a whiteboard that still had last sprint's retrospective notes on it. Someone had drawn a small cat in the corner of the whiteboard. The deploy pipeline showed green across all three stages. It was 2:15 PM on a Thursday and the application had been running without incident for forty-one days.

### Under pressure

The health check failed at 9:47 PM. The second check failed twelve seconds later. By the time the on-call engineer opened her laptop, there were twenty-three messages in the incident channel. The load balancer had marked all three targets as unhealthy. She checked the application logs. They were empty, not error-free, but empty. The log group existed. The streams existed. The last entry was from 9:46 PM, one minute before the health check failed. After that, nothing. She poured the rest of her tea into the sink. It had gone cold.

### Mundane-beside-crisis (signature device)

The security group had four inbound rules on Monday. By Wednesday it had one. The engineering lead had removed the others during a hardening sprint, working through a checklist on his phone while waiting for his daughter's piano recital to start. The rule for port 443 was the third one he deleted. He did not write down which rules he removed. The recital started late. His daughter played a piece by Clementi, and he recorded the first thirty seconds to send to his mother.

### Discovery moment

Watanabe opened the security group in the VPC console. There were three inbound rules: SSH from the office IP, ICMP from the monitoring subnet, and a custom rule for port 8080 from a single IP she did not recognize. There was no rule for port 443. She scrolled down. She scrolled back up. She checked the group ID against the instance's network interface. It was the right group. Port 443 was not there.
