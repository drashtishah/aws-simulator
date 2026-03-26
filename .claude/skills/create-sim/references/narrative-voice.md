---
tags:
  - type/reference
  - scope/narrative-voice
  - status/active
---

# Narrative Voice Style Guide

Style reference for incident simulation narration in `story.md` files (create-sim) and live narrator improvisation (play). Based on the prose voice of Emi Yagi's *Diary of a Void* (translated by David Boyd and Lucy North), adapted for AWS incident scenarios.

---

## 1. Overview

Emi Yagi (born 1988, Tokyo) is a women's magazine editor whose debut novel *Diary of a Void* won the Dazai Osamu Prize. The novel follows Shibata, a 34-year-old office worker at a cardboard tube manufacturer, who fakes a pregnancy to escape the invisible labor dumped on her as the only woman in her department. The book is structured as diary entries tracking each week of the fabricated pregnancy.

The voice works for incident simulations because it treats extraordinary events with the same observational flatness as ordinary ones. An S3 bucket breach gets the same tonal weight as a coffee machine breaking. This creates tension through *understatement* rather than dramatization, and lets the technical details carry their own gravity.

---

## 2. Sentence-Level Patterns

### Length and structure

Sentences are short to medium. Rarely compound-complex. The default unit is a simple declarative statement.

**Pattern: Subject did thing. Detail. Another detail.**

```
Shibata checked the CloudTrail logs. There were 40,000 GetObject requests
from an IP address in Romania. The bucket policy had no condition keys.
```

**Pattern: Observation, then implication stated as fact (not as alarm).**

```
The IAM role had AdministratorAccess attached. It had been created six
months ago. Nobody in the team could say by whom.
```

**Pattern: Time marker, then action, then mundane detail alongside it.**

```
At 2:47 AM, the Lambda function timed out for the third time. The on-call
engineer was heating leftover rice in the break room microwave.
```

### Rhythm

Vary between short punches and slightly longer descriptive sentences. Never let three long sentences stack. A paragraph of all-short sentences reads like a telegram -- mix in one medium sentence per three short ones.

**Good rhythm:**

```
The dashboard showed five alarms in red. Three had been firing since
Tuesday. Nobody had acknowledged them. The team had a rotation schedule
pinned to the wall near the elevator, but the current week's slot was blank.
```

**Bad rhythm (too uniform):**

```
The dashboard showed five alarms in red. Three had been firing since
Tuesday. Nobody had acknowledged them. The rotation schedule was blank.
The elevator was nearby.
```

---

## 3. The Flat Affect Technique

"Flat affect" means the narrator's emotional register does not change between mundane and critical events. The prose stays level. The reader supplies the alarm.

### What flat means in practice

- No exclamation marks. Ever.
- No intensifiers: "extremely," "incredibly," "catastrophically," "shockingly."
- No narrator-level judgment: "This was a disaster." "The situation was dire."
- No rhetorical questions from the narrator.
- Temperature stays the same whether describing a coffee order or a data breach.

### How tension works without stating tension

Tension comes from *the facts themselves* being alarming, presented in a calm voice. The gap between what is being described and how it is being described creates dissonance. The reader feels the tension precisely because the narrator does not.

**Flat (correct):**

```
The security group allowed inbound traffic on all ports from 0.0.0.0/0.
It had been that way for eleven months. Fourteen production databases sat
behind it.
```

**Not flat (incorrect):**

```
Shockingly, the security group was wide open to the entire internet.
For almost a year, fourteen critical production databases had been
dangerously exposed.
```

The first version is more unsettling. The facts do the work.

---

## 4. Mundane-Beside-Crisis Stacking

This is the signature Yagi technique. Place an ordinary, unremarkable detail immediately adjacent to an extraordinary one, at the same syntactic weight. Do not signal which is which. The reader's brain does the sorting.

### Pattern: Crisis fact. Mundane fact. No transition.

```
The RDS instance had been publicly accessible since March. Someone had
left a bag of mandarins on the ops desk and they were starting to smell.
```

```
All three Availability Zones reported degraded performance. The vending
machine on the fourth floor was out of the barley tea again.
```

```
CloudWatch showed memory utilization at 98.7% across the fleet. Hayashi
had brought his daughter's school permission slip to the office by mistake.
```

### Why this works

It mirrors how incidents actually feel from inside them. People do not stop being human during outages. They notice the coffee is cold. They hear the hum of the air conditioning. The world does not rearrange itself around the crisis. By keeping these details, the narration stays honest and grounded.

### Rules

- The mundane detail must be genuinely mundane: food, weather, an object, a small personal errand.
- Never use the mundane detail as a metaphor or symbol. The mandarins are just mandarins.
- Place them in the same paragraph, not set apart as a separate "humanizing" section.
- Do not overuse. Once or twice per scene. If every paragraph has one, it becomes a gimmick.

---

## 5. What the Narrator Does and Does Not Do

### The narrator does

- Observe and report what is visible.
- State facts, including numerical facts, without commentary.
- Record what people said, in short paraphrase or direct speech.
- Note small physical details of the environment (weather, objects, sounds).
- Track time passing (timestamps, day of the week, how long something has been true).

### The narrator does not

- Judge anyone's competence or decisions.
- Editorialize ("This should never have happened").
- Express surprise or alarm.
- Use dramatic irony explicitly ("Little did they know...").
- Foreshadow ("This would turn out to be the beginning of something much worse").
- Use metaphor or simile for emotional effect.
- Address the reader directly.
- Speculate on motives unless the character is the narrator and is speculating about their own.

### The narrator's relationship to knowledge

The narrator knows what is in the logs, the dashboards, and the room. The narrator does not have omniscient knowledge of what is happening inside AWS services. This keeps the narration grounded in what an on-call engineer would actually be able to see.

---

## 6. Dialogue and Interaction

Characters speak in short, factual lines. They do not give speeches. They often talk past each other or respond obliquely.

### Patterns

**Direct and clipped:**

```
"The ALB is returning 502s," Tanaka said.
"Since when?"
"About twenty minutes."
"Did you check the targets?"
"They're all unhealthy."
```

**Oblique (someone deflects or changes subject):**

```
"We need to roll back the deployment," Ota said.
Kimura looked at the deployment pipeline. "Has anyone told the product
team about the launch delay?"
"I'm asking about the rollback."
"I know," Kimura said. "I just think we should tell them first."
```

**Understated delivery of bad news:**

```
"The snapshot doesn't exist," Nakamura said.
"Which one?"
"The one from last night. Any of them, actually. The retention policy
was set to one day."
```

### Rules for dialogue

- No dialogue tags other than "said." Never "exclaimed," "warned," "admitted," "revealed."
- Characters do not raise their voices in the text. If someone is angry, show it through what they do (leave the room, go silent) not through exclamation marks.
- People in incidents are often too tired or too focused to be articulate. Let dialogue be imperfect.
- Characters sometimes say nothing. Silence is a valid response. "Ota said nothing" is a complete sentence.

---

## 7. Pacing

### Time compression

Skip hours or days in a single sentence. Do not narrate every moment.

```
Three days passed. The memory leak was still there.
```

```
By Friday, the ticket had been reassigned four times.
```

### Time expansion

Slow down for the moment of discovery or realization. Give it more sentences, more detail, but keep the tone flat.

```
Watanabe opened the IAM console. She clicked on the role. The trust
policy listed an account ID she did not recognize. She copied it into
a text file. She searched the organization's account list. The ID was
not there.
```

### Diary-entry structure

In *Diary of a Void*, each entry is a self-contained unit covering a span of time (usually a week). For sim narratives, each story beat should work the same way: a contained scene with its own temporal boundaries.

Do not use cliffhangers between scenes. Each scene ends on a factual note, not a dramatic one. The next scene picks up at a new point in time.

**Good scene ending:**

```
Sato closed the laptop at 11:40 PM and left it on the desk. The office
was empty. The alarm was still firing.
```

**Bad scene ending:**

```
But what Sato didn't know was that the worst was yet to come.
```

---

## 8. Anti-Patterns

Specific things to avoid, with bad examples and corrected versions.

### Anti-pattern: Emotional narration

Bad:
```
The team was horrified to discover that the database had been completely
wiped out. In a devastating blow, months of customer data vanished in
an instant.
```

Corrected:
```
The database was empty. The last backup was from October, three months
ago. It contained 40% of the current customer records.
```

### Anti-pattern: Dramatic intensifiers

Bad:
```
CPU utilization skyrocketed to a staggering 100% as the system buckled
under the enormous, unprecedented load.
```

Corrected:
```
CPU utilization reached 100% at 3:12 PM. It stayed there.
```

### Anti-pattern: Narrator commentary

Bad:
```
In a classic case of poor security hygiene, the access keys had been
committed to a public repository -- a rookie mistake that would haunt
the team for weeks to come.
```

Corrected:
```
The access keys were in the repository's README file. The repository
was public. It had been public since it was created.
```

### Anti-pattern: Forced humor or cleverness

Bad:
```
The Lambda function, much like the team's morale, had officially timed out.
```

Corrected:
```
The Lambda function timed out. The team had been in the war room for
six hours.
```

### Anti-pattern: Omniscient foreshadowing

Bad:
```
None of them realized that this small configuration change would
cascade into the company's worst outage in five years.
```

Corrected:
```
Mori pushed the configuration change at 4:55 PM. She turned off her
monitor and left for the day.
```

### Anti-pattern: Exclamation and rhetorical questions

Bad:
```
How could no one have noticed the billing spike? The charges had tripled
overnight!
```

Corrected:
```
The bill for March was three times the February bill. The billing alert
threshold was still set to the default.
```

### Anti-pattern: Overwriting mundane details

Bad:
```
The fluorescent lights hummed their eternal, indifferent song above the
weary engineers, casting a pale, sickly glow over the scattered remains
of cold pizza and forgotten ambitions.
```

Corrected:
```
The fluorescent lights hummed. There was pizza on the table from lunch.
```

---

## Sources

Research compiled from critical reviews and analysis:

- [Harvard Review -- Diary of a Void](https://www.harvardreview.org/book-review/diary-of-a-void/)
- [California Review of Books -- Diary of a Void](https://calirb.com/diary-of-a-void-by-emi-yagi/)
- [Cha Journal -- Reimagining the Void](https://chajournal.com/2024/09/20/a-void/)
- [Electric Literature -- Emi Yagi interview](https://electricliterature.com/emi-yagi-novel-diary-of-a-void/)
- [Goodreads -- Diary of a Void](https://www.goodreads.com/book/show/59629744-diary-of-a-void)
- [The Complete Review -- Diary of a Void](https://www.complete-review.com/reviews/japannew/yagie.htm)
- [West Trade Review -- Metaphor and Metamorphosis in Diary of a Void](https://westtradereview.com/westendyagireview22.html)
- [Asian Review of Books -- Diary of a Void](https://asianreviewofbooks.com/diary-of-a-void-by-emi-yagi/)
