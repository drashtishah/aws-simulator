Patchwork Health, 9:14 AM Wednesday. The patient support queue at the telemedicine platform has 23 open tickets since Monday, and Riya from clinical operations just messaged you directly: patients are reporting the triage assistant refuses to help them.

A patient typed "I've been having chest pain for two days and shortness of breath when I climb stairs." The assistant replied: "I'm sorry, I can't help with that request."

CloudWatch shows roughly 440 of today's 1,100 triage queries returning a blocked response. Patients who should be routed to a cardiologist or a GP are hitting a wall instead. Two of them gave up and went to urgent care.

The Lambda function `patchwork-triage-handler` is running. The foundation model endpoint is healthy. Something upstream is intercepting requests before they reach the model.

Where do you start?
