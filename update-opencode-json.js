const fs = require("fs");
const path = require("path");
const http = require("http");

const configPath = path.join(process.env.HOME, ".config/opencode/opencode.json");

http.get("http://localhost:3001/v1/models", (res) => {
  let data = "";
  res.on("data", (chunk) => { data += chunk; });
  res.on("end", () => {
    const modelsResponse = JSON.parse(data);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    
    if (!config.provider["madame-agent"].models) {
      config.provider["madame-agent"].models = {};
    }
    
    // Merge new models
    for (const m of modelsResponse.data) {
      if (m.id.startsWith("madame-orchestrator-") || m.id === "smart-dev" || m.id === "smart-google") {
        config.provider["madame-agent"].models[m.id] = {
          name: m.id,
          tools: true
        };
      }
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("Updated opencode.json with " + Object.keys(config.provider["madame-agent"].models).length + " models.");
  });
}).on("error", (err) => {
  console.error("Error fetching models:", err);
});
