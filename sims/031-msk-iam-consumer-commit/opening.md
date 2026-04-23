Linden Goods, Monday 08:50 Eastern. Customer support has forty-one tickets from the weekend: "I was charged twice", "I received two duplicate shipments", "my order total doubled". The oldest ticket is from Saturday morning. The newest came in six minutes ago.

Fulfillment's dashboard says the service is healthy. Charges are going through. Shipments are being picked. Nothing is failing.

The MSK cluster is green. Producers are producing. Consumers are consuming. Kafka consumer-group lag shows a sawtooth pattern: climbing, then dropping to the original baseline, then climbing again. The drops line up with the EC2 Auto Scaling group's health check restarts.

The only change last week was the migration of the order-processor consumer group from SASL/SCRAM to MSK IAM access control. That rolled out Friday afternoon.

Where do you start?
