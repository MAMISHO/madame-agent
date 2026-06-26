import type { TuiPlugin } from "../types/tui";

export const tui: TuiPlugin = async (api, _options, _meta) => {
  // Register the /madame-stats command that fetches costs from localhost:3001/v1/Costs
  api.command.register(() => [
    {
      title: " Madame Stats",
      value: "madame-stats",
      description: "Consultar costos desde MacOS",
      slash: { name: "madame-stats" },
      onSelect: async () => {
        try {
          const response = await fetch("http://localhost:3001/v1/Costs");
          const data = await response.json();
          api.ui.toast({
            variant: "success",
            title: " Costs fetched",
            message: JSON.stringify(data),
          });
        } catch (error) {
          api.ui.toast({
            variant: "error",
            title: "Error fetching costs",
            message: String(error),
          });
        }
      },
    },
  ]);

  // Register the sidebar_content slot with a proper SolidJS-based TuiSlotPlugin object.
  // Returning an empty element to satisfy the JSX requirement without rendering anything.
  api.slots.register({
    slots: {
      sidebar_content: () => null,
    },
  });
};
