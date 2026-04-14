12:01 AM. Your pager fires: CRITICAL, `vellora-prod-alb` returning 503 errors, checkout error rate climbing.

Vellora's midnight flash sale went live sixty seconds ago. Traffic on the storefront jumped from 200 requests per second to over 2,000. The CloudWatch dashboard flipped from green to red in a single refresh.

Add-to-cart buttons are spinning. Checkout pages are timing out. Five hundred limited-edition pieces are sitting in inventory, untouched.

Your phone is also lit up with a Slack message from Maya, the head of growth: "Instagram is blowing up. Customers are posting error screenshots. What is happening?"

The Auto Scaling group shows two t3.large instances behind `vellora-prod-alb`. They are configured to scale up to twenty. They have not.

Where do you start?
