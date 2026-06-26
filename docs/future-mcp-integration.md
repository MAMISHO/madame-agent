# Future Feature: Model Context Protocol (MCP) Integration

## Overview
As Madame-Agent evolves into a more powerful standalone orchestration proxy, there is a need to extend subagent capabilities beyond static files and basic filesystem tools. 
While the "Skills System" (Option A) provides static context and knowledge injection (e.g., API documentation, architectural guidelines), it lacks the ability to give agents *dynamic* execution capabilities (like querying a live database, executing web searches, or interfacing with IDEs).

The planned **Model Context Protocol (MCP)** integration addresses this by allowing Madame-Agent to connect to external MCP servers and expose their tools natively to the orchestration loop.

## Motivation & Use Cases
- **DevToys for Agents**: Similar to Microsoft's DevToys, MCP servers can provide specialized toolsets (e.g., AST parsers, JSON formatters, linting tools) under demand.
- **Dynamic Context Retrieval**: Instead of loading all skills upfront, an MCP server could provide a `search_knowledge_base` tool that retrieves only the necessary documentation chunks.
- **External Integration**: Subagents could use MCP to interface directly with GitHub (PR creation), JIRA (ticket reading), or OpenCode's live context without needing custom-built Node.js plugins for each integration.

## Proposed Architecture

1. **MCP Client Layer**:
   - Introduce an MCP Client implementation in `src/mcp/mcp-client.service.ts`.
   - This service will manage connections (stdio or SSE) to configured MCP servers.

2. **Configuration (`routing.yaml`)**:
   ```yaml
   mcp:
     enabled: true
     servers:
       - name: "opencode-tools"
         command: "npx"
         args: ["@opencode-ai/mcp-server"]
       - name: "devtoys"
         command: "devtoys-mcp"
   ```

3. **Tool Registry Integration**:
   - The `ToolRegistryService` will dynamically fetch the list of tools from connected MCP servers via `tools/list`.
   - These tools will be mapped into Madame-Agent's internal `ToolDefinition` format and appended to the tools list sent to the LLM (Orchestrator or Subagent).

4. **Execution Flow**:
   - When the LLM requests an MCP tool call (e.g., `opencode-tools_search_docs`), `ToolLoopService` routes the request to the `MCPClientService`.
   - The MCP client sends the `tools/call` JSON-RPC message, waits for the response, and returns the result back to the `ToolLoopService`.

## Phased Implementation Plan
1. **Phase 1: Basic Stdio Client**: Implement a basic MCP client that spawns local processes and communicates over `stdio`. Map MCP tools to local tools.
2. **Phase 2: Orchestrator Tool Filtering**: Allow the orchestrator to decide *which* MCP tools to pass down to a subagent to avoid context overflow.
3. **Phase 3: SSE & Remote Servers**: Add support for Server-Sent Events to connect to remote MCP servers.
