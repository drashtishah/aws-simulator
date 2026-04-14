Calendine. Scheduling software. Eight engineers, one API endpoint, and an enterprise demo at 14:45 UTC.

At 14:12 UTC the pipeline finished green. No warnings, no errors. You closed the terminal and went to get water.

At 14:18 UTC the smoke test returned `{"message": "Internal server error"}`. API Gateway logs in us-east-1 show `ResourceNotFoundException: Function not found: arn:aws:lambda:us-east-1:491783620174:function:calendine-booking-api`.

The Lambda console in us-east-1 is empty. No function named `calendine-booking-api` exists there.

Priya from sales has been prepping the enterprise demo since Monday. She just pinged: the client lands in 27 minutes.

The pipeline says the deploy succeeded. Where is the function?
