# Kanevo Git Map

A local, interactive map of Kanevo’s commits, branches, worktrees and GitHub
state.

## Open it

Double-click `Open Kanevo Git Map.command` in the Kanevo folder.

The launcher starts a small local server at <http://127.0.0.1:8765/> and opens
the map in your browser. Keep its Terminal window open while using the map.
Press Control-C in that window when you are finished.

## What the buttons do

- **Update map** rescans local Git data only.
- **Fetch GitHub + update** runs `git fetch --all --prune`, then rescans local
  data and reads public GitHub repository/workflow metadata.
- Clicking a **worktree** jumps to its head commit.
- Clicking a **branch** filters the flow to that branch.
- Clicking a **commit** shows its message, files, line totals and patch.
- **Copy AI brief** copies a concise commit explanation prompt.
- **Compare branches** is read-only. It shows what differs and offers safe
  inspection commands. It does not merge.

## Safety

The server binds only to `127.0.0.1`. It does not expose a merge, reset, delete,
commit, push or checkout endpoint. The only Git metadata write it can trigger is
the explicit fetch button updating remote-tracking refs.
