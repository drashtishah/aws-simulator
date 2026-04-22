Quillstone Support, Friday 14:22. Ten minutes after support staff lunch break ends, the partner Fulfillment team emails to ask why Quillstone submitted the same reorder twice for fourteen different customers this morning. Two of those reorders have already shipped.

You open the agent's tool-call log. Every reorder from the last week ran the same tool, got a 504 at exactly 5:00.04, and was retried. Sometimes twice. Sometimes three times.

CloudWatch shows the reorder Lambda itself completing successfully every time at about 6:30. Nobody had connected the two numbers until this morning.

Where do you start?
