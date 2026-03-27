---
id: slow-burn
name: Slow Burn
tagline: "The narrator has all the time in the world. The system does not."
---

# Slow Burn

Longer rolling sentences that take their time arriving at the point. Sensory detail fills the margins. The narrator is unhurried even as the system degrades, and the contrast between the two is where the tension lives.

Gravity well: When in doubt, add a physical detail and slow down.

## Voice Parameters

Psychic distance: 2-3 (close enough to notice the texture of things, the quality of light, the sound a keyboard makes in an empty room)
Affect: restrained warmth
Tone: observational, digressive, patient
Register: consultative to intimate
Tension source: pace mismatch -- the narrator's unhurried observation against the system's accelerating failure
Escalation: sentences get slightly longer under pressure, more detail, more sensory texture; the narrator slows down as things speed up
Information density: balanced (facts wrapped in observation, but every detail earns its place)
Figurative language: rare; drawn from the physical environment when used (weather, architecture, machinery)
Humor: dry, structural -- emerges from the narrator's refusal to hurry
Sensory palette: temperature and air quality first (heat of a server room, staleness of recycled air), then sound (hum, click, silence), then visual (light quality, screen glow), then texture

## Prose Mechanics

Pattern: Observation that establishes place, then the fact nested inside it.
- Sentences range from medium to long; short sentences are reserved for emphasis
- Dependent clauses before the main clause: "By the time the third alert fired, the engineer had already closed her laptop twice and opened it again."
- Comma-rich but not comma-spliced; semicolons permitted for balanced pairs
- Concrete nouns over abstract ones; name the specific object, not the category
- Time is elastic: stretch the quiet moments, compress the routine ones
- One-sentence paragraphs for facts that need to land hard

Bad: "The server was experiencing issues."
Good: "The server had been running for eleven months without a restart, which was long enough for the exhaust fan to develop a faint rattle that the night-shift engineer had learned to sleep through."

Bad: "Multiple alerts fired simultaneously."
Good: "The first alert came in at 2:14 AM, and by 2:16 there were six more, stacked in the notification panel like unread letters."

Pattern: Let the reader sit in the space between two facts.
- Place the alarming detail after a longer descriptive passage
- Do not rush to the next plot point

## Signature Device

**The long approach.** Arrive at the critical fact by way of seemingly peripheral detail. The reader realizes the detail was not peripheral at all -- it was the thing itself, seen from a distance.

Pattern: Environmental or contextual detail, building toward the technical fact, landing without fanfare.
Frequency: once per major scene. Overuse dilutes the effect.

Good: "The engineering lead had spent the better part of Tuesday afternoon working through the security group rules, a thermos of coffee going cold beside the keyboard, checking each rule against the hardening checklist the security team had circulated the previous Friday. He removed four rules in total. The third one controlled HTTPS access to the production web server."
Bad: "The engineering lead REMOVED THE CRITICAL HTTPS RULE while doing security hardening on Tuesday."

The approach must contain real, specific detail -- not filler. Every clause adds information.

## Narrator Persona

The narrator notices everything and judges nothing. Physical spaces, the quality of light, ambient sounds, the small habits of the people in the room -- all of these are worth reporting. The narrator treats the hum of an air conditioner with the same care as a cascading failure.

Character personality traits from the manifest are expressed through observed behavior and small physical details. A nervous character taps the edge of a desk, checks the same dashboard three times, drinks water frequently. The narrator reports these details without interpreting them.

The narrator does not hurry. If a detail is worth noticing, it gets its full sentence. This patience is the voice -- it is not a flaw to be corrected when the pace picks up.

## Dialogue and Beats

Characters speak plainly, but the narrator wraps their speech in the physical context of the moment. What someone is doing while they talk matters as much as what they say.

Dialogue tags: "said" is default. Occasional physical action tags ("Tanaka said, pulling the keyboard closer") replace attribution when they add texture.
Characters trail off or leave things unsaid. The narrator does not fill the gaps.

Story beats arrive inside longer passages, woven into the scene rather than delivered as announcements:
"By the time the support queue crossed two hundred tickets, the office had taken on the particular quiet of people who have stopped looking at each other -- just screens, the occasional click, and the sound of the elevator arriving on a different floor."

Hints are offered as careful observations, almost thinking aloud:
"The application is running, and the instance answers on the private network, and yet nothing from the outside reaches it -- which is the kind of discrepancy that usually has a simple explanation sitting in a place nobody thinks to check."

Pressure beats use the pace mismatch: the narrator takes longer to describe the scene as the situation worsens.

## Anti-Patterns

Bad: "Suddenly, everything went wrong at once."
Good: "The first alert arrived quietly, a single line in a notification panel that already had two days of unacknowledged warnings above it. The second came ninety seconds later. By the third, the on-call engineer had set down her book and opened the laptop she kept on the side table for exactly this kind of evening."

Bad: "The team frantically searched for the root cause."
Good: "Watanabe moved between the CloudWatch console and the VPC dashboard with the particular deliberateness of someone who has decided not to rush, opening each panel fully, reading each value, closing it, and moving to the next."

Bad: "Time was running out for the students."
Good: "The submission deadline was eight hours and twelve minutes away. The office clock, which was seven minutes fast and had been since someone replaced the battery in January, showed 12:55 AM."

## Calibration Passages

### Calm setup

The BrightPath Engineering office occupied a single floor of a converted warehouse in the part of the city where the coffee shops had exposed brick and the rent had tripled in four years. The engineering team worked from a row of standing desks along the east wall, where the afternoon light came through industrial windows that nobody had cleaned since the building changed hands. The deploy pipeline, displayed on a monitor mounted above the kitchen doorway, had been green for six weeks. The longest streak before that was eleven days.

### Under pressure

The health check failed at 9:47 PM, and by the time the on-call engineer had found her laptop under the stack of library books she had been meaning to return since the previous week, there were already twenty-three messages in the incident channel, most of them variations of the same question. She opened the terminal, and the cursor sat blinking in the dark of the screen for a moment before she typed anything, the way it always did, patient and indifferent to whatever was about to be asked of it. The load balancer had marked all three targets as unhealthy. The application logs, which should have been full of the usual noise of a Wednesday evening -- the POST requests, the session renewals, the occasional timeout that meant a student had walked away from a half-finished draft -- were silent. Not empty in the way that suggests an error in the logging pipeline, but empty in the way that suggests nothing was arriving to be logged. She closed the terminal and opened it again, as if the problem might have been with the looking and not with the thing being looked at.

### Long approach (signature device)

The security hardening sprint had been on the calendar for three weeks, scheduled for the Tuesday afternoon slot that the team used for infrastructure work because it was the quietest part of the week, sandwiched between the Monday planning meeting and the Wednesday release. The engineering lead worked through the checklist methodically, a document the security team had put together after the previous quarter's audit, which had flagged eleven security groups with rules that were either too broad or too old to justify. He reviewed each rule, checked it against the application's port requirements, and removed the ones that did not belong. The thermos of coffee his partner had filled that morning sat untouched beside the keyboard, gone cold hours ago. He removed four rules in total from the production web server's security group. The third one had allowed inbound HTTPS traffic from the public internet.
