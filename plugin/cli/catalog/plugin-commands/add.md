---
name: add
description: Use only when the user runs /stackcrew:add to add one or more add-ons (for example kafka or observability) to this project's stackcrew profile.
---
# stackcrew add

Run this from the project root:

```
{{sc:cli}} add $ARGUMENTS
```

`$ARGUMENTS` is one or more add-on ids, for example `kafka` or `kafka observability`. The command adds them to `stackcrew.json` and then runs `sync`, so the add-on rules and skills are rendered.

Add-on ids: `camel`, `kafka`, `observability`, `rabbitmq`. An add-on must apply to the project's language.

Exit codes: 0 means the add-ons were added and rendered. 1 means nothing was added or the sync did not finish: no `stackcrew.json` (run the setup interview or `init` first), an unknown or unsuitable add-on id, or a hand-edited file was skipped. Tell the user the message that was printed and stop.

An add-on can be new infrastructure for the project. If the user has not decided on it yet, ask before running the command.
