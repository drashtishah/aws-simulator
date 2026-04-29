# Opening: Yesterday's Inventory, Today's Cart

It is Tuesday, 11:42 ET. You are the on-call platform engineer at Lumenfold,
an online apparel retailer that does most of its business between 11 AM and
2 PM ET on weekdays.

In the past 90 minutes, customer-care has logged 412 tickets with the same
shape: customer ordered an item, payment succeeded, then forty minutes later
they get a "we are sorry, this item is out of stock" email. Refunds are
piling up. The fulfillment ops director is asking why search is showing
items that the warehouse system says were sold out before breakfast.

Your dashboards say:
- Inventory ingest is healthy, writing to DynamoDB at 4.1k WCU
- DynamoDB lumenfold-inventory: no throttles, no errors
- OpenSearch lumenfold-search: cluster green, query latency p99 = 84 ms
- Storefront search-api: 0 errors, normal traffic

Nothing is paging. Nothing is in red. But the search results are wrong.
