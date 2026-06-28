// @ts-nocheck
/** @jsxImportSource @opentui/solid */
import { createSignal, onCleanup, createEffect } from "solid-js";
import type { TuiPlugin, TuiCommand } from "../types/tui.js";
import { execSync } from "child_process";

interface CostStats {
  totalCloudUsd: number;
  totalSavedUsd: number;
  cloudInputTokens: number;
  cloudOutputTokens: number;
  localInputTokens: number;
  localOutputTokens: number;
}

function fetchCostsSync(sessionId?: string): CostStats | null {
  try {
    const url = sessionId
      ? `http://localhost:3001/v1/costs?sessionId=${sessionId}`
      : "http://localhost:3001/v1/costs";
    const output = execSync(`curl -s "${url}"`, {
      encoding: "utf8",
      timeout: 1000,
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function formatUsd(amount: any): string {
  const val = typeof amount === "number" && !isNaN(amount) ? amount : 0;
  return `$${val.toFixed(4)}`;
}

function formatTokens(n: any): string {
  const val = typeof n === "number" && !isNaN(n) ? n : 0;
  return val.toLocaleString();
}

function CostDashboard(props: { api: any }) {
  // Resolve active session ID from router state
  const getSessionId = () => {
    const route = props.api?.route?.current;
    if (route?.name === "session" && route.params?.sessionID) {
      return route.params.sessionID;
    }
    return "default-session";
  };

  const [stats, setStats] = createSignal<CostStats | null>(
    fetchCostsSync(getSessionId()),
  );

  // Update stats every 1 second for real-time responsiveness
  const interval = setInterval(() => {
    setStats(fetchCostsSync(getSessionId()));
  }, 1000);
  onCleanup(() => clearInterval(interval));

  // Instantly update when active session changes
  createEffect(() => {
    setStats(fetchCostsSync(getSessionId()));
  });

  const s = stats();
  const currentSessionId = getSessionId();

  return (
    <box flexDirection="column" padding={1}>
      <text bold fg="cyan">Madame-Agent Cost Tracker</text>
      <text fg="gray" size="small">
        Session: {currentSessionId}
      </text>
      {s ? (
        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" justifyContent="spaceBetween">
            <text fg="gray">Cloud Input</text>
            <text>{formatTokens(s.cloudInputTokens)}</text>
          </box>
          <box flexDirection="row" justifyContent="spaceBetween">
            <text fg="gray">Cloud Output</text>
            <text>{formatTokens(s.cloudOutputTokens)}</text>
          </box>
          <box flexDirection="row" justifyContent="spaceBetween">
            <text fg="gray">Cloud Cost</text>
            <text>{formatUsd(s.totalCloudUsd)}</text>
          </box>
          <box flexDirection="row" justifyContent="spaceBetween" marginTop={1}>
            <text fg="green">Local Input (saved)</text>
            <text>{formatTokens(s.localInputTokens)}</text>
          </box>
          <box flexDirection="row" justifyContent="spaceBetween">
            <text fg="green">Local Output (saved)</text>
            <text>{formatTokens(s.localOutputTokens)}</text>
          </box>
          <box flexDirection="row" justifyContent="spaceBetween" marginTop={1}>
            <text bold fg="green">
              Estimated Savings
            </text>
            <text bold>{formatUsd(s.totalSavedUsd)}</text>
          </box>
        </box>
      ) : (
        <text fg="red" marginTop={1}>
          Error: Unable to connect to Madame-Agent on port 3001
        </text>
      )}
    </box>
  );
}

const tui: TuiPlugin = async (api, _options, _meta) => {
  // /madame-stats slash command
  api.command.register(() => {
    const command: TuiCommand = {
      title: "Madame Stats",
      value: "madame-stats",
      description: "Show Madame-Agent cost and token statistics",
      slash: { name: "madame-stats" },
      onSelect: () => {
        // No sessionId parameter passed -> fetches overall total costs across all sessions
        const stats = fetchCostsSync();
        if (api.ui.dialog?.replace) {
          api.ui.dialog.replace(() => (
            <api.ui.Dialog size="medium" onClose={() => api.ui.dialog.clear()}>
              <box flexDirection="column" padding={1}>
                <text bold fg="cyan">Madame-Agent Overall Stats (All Sessions)</text>
                {stats ? (
                  <box flexDirection="column" marginTop={1}>
                    <text>Cloud Cost: {formatUsd(stats.totalCloudUsd)}</text>
                    <text>
                      Cloud Input Tokens: {formatTokens(stats.cloudInputTokens)}
                    </text>
                    <text>
                      Cloud Output Tokens: {formatTokens(stats.cloudOutputTokens)}
                    </text>
                    <text fg="green">
                      Local Input Tokens: {formatTokens(stats.localInputTokens)}
                    </text>
                    <text fg="green">
                      Local Output Tokens: {formatTokens(stats.localOutputTokens)}
                    </text>
                    <text bold fg="green" marginTop={1}>
                      Estimated Savings: {formatUsd(stats.totalSavedUsd)}
                    </text>
                  </box>
                ) : (
                  <text fg="red" marginTop={1}>
                    Failed to fetch costs from localhost:3001
                  </text>
                )}
              </box>
            </api.ui.Dialog>
          ));
        } else if (api.renderer?.print) {
          if (stats) {
            api.renderer.print(
              [
                "## Madame-Agent Overall Costs (All Sessions)",
                "",
                "| Metric | Value |",
                "|--------|-------|",
                `| Cloud Input Tokens | ${formatTokens(stats.cloudInputTokens)} |`,
                `| Cloud Output Tokens | ${formatTokens(stats.cloudOutputTokens)} |`,
                `| Cloud Cost | ${formatUsd(stats.totalCloudUsd)} |`,
                `| Local Input Tokens (saved) | ${formatTokens(stats.localInputTokens)} |`,
                `| Local Output Tokens (saved) | ${formatTokens(stats.localOutputTokens)} |`,
                `| **Estimated Savings** | **${formatUsd(stats.totalSavedUsd)}** |`,
              ].join("\n"),
            );
          } else {
            api.renderer.print("Failed to fetch costs from localhost:3001");
          }
        }
      },
    };
    return [command];
  });

  // Sidebar cost dashboard
  api.slots.register({
    slots: {
      sidebar_content: () => <CostDashboard api={api} />,
    },
  });
};

const plugin = { id: "madame-stats", tui };
export default plugin;
