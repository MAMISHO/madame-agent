import { MadameAgent } from "/Users/mamisho/.config/opencode/plugins/madame-agent.ts";

async function test() {
  const plugin = await MadameAgent({});
  const provider = plugin.provider;
  const models = await provider.models({ id: "madame-agent" }, {});
  console.log(models);
}
test();
