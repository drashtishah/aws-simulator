# AWS Incident Simulator

AWS breaks in quiet ways. A security group drops a rule. A function deploys to the wrong region. A database fills its storage while everyone is asleep.

This is a game about those moments.

You investigate simulated AWS incidents inside Claude Code. You read logs, query service consoles, trace the architecture, and propose a fix. A narrator -- flat-voiced, factual, unhurried -- walks you through each scenario. There is no timer. There is no score. There is only the problem, and what you find.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## Getting Started

Open a terminal and clone the repository:

```
git clone --depth 1 https://github.com/drashtishah/aws-simulator.git
cd aws-simulator
```

Start Claude Code:

```
claude
```

Initialize your workspace:

```
/setup
```

This creates your learning profile. Nothing is written until you run it.

Start playing:

```
/play
```

The simulator presents available incidents based on your current level. You pick one. You investigate.

## Example Simulation

### Four Million Records, One by One

An e-commerce startup's product search goes live. Within minutes, the order pipeline stalls. The new Lambda function scans four million DynamoDB items on every request, consuming all provisioned read capacity. The orders table starves. You trace the symptoms from Lambda timeouts back to a full-table Scan hiding behind a FilterExpression that filters nothing until after all the data is already read.

[![asciicast](https://asciinema.org/a/d7CMYd0AFgnlsMqZ.svg)](https://asciinema.org/a/d7CMYd0AFgnlsMqZ)
