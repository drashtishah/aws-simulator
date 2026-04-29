# Opening: The Cart That Forgot Itself

It is Saturday, 14:08 ET. Cinderlane runs an online home goods store and is
in the middle of its Spring Sale, which kicks off every Saturday in May.

You are the on-call backend engineer. Customer support has dispatched you
on a class of tickets that has been coming in for two hours:

- "I added a lamp and a rug. Refreshed. Both gone. Added them again, they
  stuck. At checkout it said the lamp was twice in my cart but no rug."
- "My cart looks empty but checkout says I have $284 of items in it."
- "I added a sofa, came back ten minutes later, the cart shows the sofa.
  Closed the tab, came back, no sofa."

Roughly 3,400 of these reports in the last two hours. Engineering Slack is
quiet. The cart-update Lambda has zero errors. The DynamoDB cinderlane-carts
table dashboard shows no error rate. The Redis cluster is healthy.

The Spring Sale runs until midnight. The CTO is asking for an update every
30 minutes.
