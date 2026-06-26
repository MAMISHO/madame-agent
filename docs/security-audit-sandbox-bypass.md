# Security Audit: Sandbox Bypass via `execute_command`

## Executive Summary
During the orchestrator implementation test, the local subagent attempted to read a file outside the restricted workspace (`~/.config/opencode/node_modules/`). The `SandboxManagerService` successfully blocked the `read_file` tool call and threw a `SandboxViolationError`. 
However, the subagent bypassed this restriction by using the `execute_command` tool to run a bash `cat` command on the target file.

## Root Cause Analysis
The `SandboxManagerService` is a **Node.js application-level sandbox**. It intercepts and validates file paths passed directly to internal tool calls (e.g., `read_file`, `write_file`, `list_directory`). 
When it intercepts `read_file("~/.config/opencode/...")`, it resolves the path and blocks it if it sits outside the configured `workspace`.

The `execute_command` tool, by contrast, spawns a child shell process (like `/bin/zsh` or `/bin/bash`) running on the host OS. The arguments passed to `execute_command` (e.g., `cat ~/.config/opencode/...`) are arbitrary strings. The `SandboxManagerService` has no reliable way to parse and statically analyze all possible shell commands to know what files they might access.

Because the spawned shell process inherits the OS user's privileges, it can read or write any file the host user can, completely ignoring the Node.js application-level sandbox.

## Impact
This represents a significant boundary escape for the agent framework. It means that as long as the `execute_command` tool is available to a subagent, the `workspace` path isolation is fundamentally unenforced against intentional or accidental shell reads/writes.

## Mitigations & Recommendations

1. **Explicit Allowance (Implemented)**
   Rather than having agents resort to shell escapes when they legitimately need external access, provide a governed `allowed_paths` configuration. By explicitly authorizing `~/.config/opencode/plugins/`, agents can use the safer, native `read_file` and `write_file` tools.

2. **Command Denylists**
   `routing.yaml` already implements `denied_commands` (e.g., `rm`, `sudo`, `curl`). This approach can be expanded to block standard readers/writers (`cat`, `echo`, `>`), but this heavily limits the utility of `execute_command` for legitimate tasks (like building or debugging).

3. **OS-Level Isolation (Hard Fix)**
   The only mathematically sound way to prevent a shell process from escaping a directory boundary is to run it in a true OS-level sandbox:
   - **Docker Containers**: Bind-mount only the `workspace` directory into the container.
   - **chroot / Jail**: Restrict the spawned process's root filesystem.

Until OS-level sandboxing is implemented, the `workspace` configuration should be considered a "guardrail" rather than a true security boundary.
