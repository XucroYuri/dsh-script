---
name: script-studio
description: Use the Script Studio Host Contract to inspect a screenplay hierarchy or create an episodic Season.
---

# Script Studio

Use the `script-studio` MCP tools for the current local development slice:

- `script_studio_capabilities` negotiates Host Contract v1 capabilities;
- `script_studio_get_project_hierarchy` reads the Team/IP/Project/Season/Episode hierarchy;
- `script_studio_create_season` creates one episodic Season and its first Episode with an expected Project revision and idempotency key.

The local fixture is deterministic and development-only. It is not cloud storage, authentication, real-time collaboration, or production authorization. Do not claim that a local result has been approved or written to Canon. Preserve stable error codes when reporting failures.
