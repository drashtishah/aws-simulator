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
