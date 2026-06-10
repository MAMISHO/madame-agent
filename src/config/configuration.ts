import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

export default () => {
  const yamlPath = process.env.ROUTING_CONFIG_PATH || 'routing.yaml';
  const fullPath = join(process.cwd(), yamlPath);

  let routingConfig = {};
  try {
    routingConfig = yaml.load(readFileSync(fullPath, 'utf8')) as Record<
      string,
      any
    >;
  } catch (error) {
    console.error(`Error loading routing config from ${fullPath}:`, error);
  }

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    hfApiKey: process.env.HF_API_KEY,
    ...routingConfig,
  };
};
