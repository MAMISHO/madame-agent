import { Sequelize } from "sequelize-typescript";
import { HarnessEntity } from "./entities/harness.entity";
import { AgentConfigEntity } from "./entities/agent-config.entity";
import { ProviderConfigEntity } from "./entities/provider-config.entity";
import { ExecutionLogEntity } from "./entities/execution-log.entity";
import { ScalableModelEntity } from "./entities/scalable-model.entity";
import { join, resolve } from "path";
import { readFileSync, existsSync } from "fs";
import * as yaml from 'js-yaml';

export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: join(process.cwd(), "apps/backend/madame-agent.sqlite"),
  logging: false,
});

function getDefaultPromptText(role: string): string {
  const filenameMap: Record<string, string> = {
    preparer: 'preparer.md',
    planner: 'planner.md',
    orchestrator: 'orchestrator-delegate.md',
    executor: 'executor.md',
    qa: 'qa.md',
    supervisor: 'supervisor.md',
  };
  const file = filenameMap[role.toLowerCase()];
  if (!file) return `Default system instructions for ${role}`;

  const pathsToTry = [
    join(process.cwd(), 'apps/backend/src/prompts/templates', file),
    join(process.cwd(), 'apps/backend/dist/prompts/templates', file),
    join(__dirname, '../../../../prompts/templates', file),
    join(__dirname, '../../../../../prompts/templates', file),
    resolve(__dirname, '..', '..', '..', 'prompts', 'templates', file),
  ];

  for (const path of pathsToTry) {
    if (existsSync(path)) {
      try {
        return readFileSync(path, 'utf8').trim();
      } catch {
        // ignore and try next path
      }
    }
  }
  return `Default system instructions for ${role}`;
}

export class DataBaseProviderFactory {
  public async connect(): Promise<void> {
    try {
      await sequelize.authenticate();
      console.log("SQLite database connected successfully.");
      sequelize.addModels([
        HarnessEntity,
        AgentConfigEntity,
        ProviderConfigEntity,
        ExecutionLogEntity,
        ScalableModelEntity,
      ]);
      await sequelize.sync({ force: false });
      console.log("Database models synchronized.");

      // Startup Seeding: Seed default harnesses if database is empty
      let defaultHarnesses = await HarnessEntity.findAll({ where: { isDefault: true } });
      if (defaultHarnesses.length === 0) {
        
        function resolveModelAndProvider(
          target: string,
          yamlData: any
        ): { providerId: string; modelName: string } {
          const providers = yamlData.providers || {};
          const modelPairs = yamlData.model_pairs || [];

          if (target.includes('+')) {
            const pair = modelPairs.find((p: any) => 
              p.name === target || 
              p.id === target ||
              (p.name && p.name.toLowerCase().replace(/\s+/g, '') === target.toLowerCase().replace(/\s+/g, ''))
            );
            if (pair) {
              return { providerId: 'madame-duo', modelName: pair.id };
            }
            return { providerId: 'madame-duo', modelName: target };
          }

          if (providers[target]) {
            const config = providers[target];
            const type = config.type || 'ollama';
            let providerId = 'ollama';
            if (type === 'cloud') {
              const prov = (config.provider || '').toLowerCase();
              if (prov.includes('google') || prov.includes('gemini')) providerId = 'gemini';
              else if (prov.includes('openai')) providerId = 'openai';
              else if (prov.includes('anthropic')) providerId = 'anthropic';
              else providerId = prov || 'cloud';
            }
            return { providerId, modelName: config.model || target };
          }

          for (const [key, config] of Object.entries(providers) as any[]) {
            if (config.model === target) {
              const type = config.type || 'ollama';
              let providerId = 'ollama';
              if (type === 'cloud') {
                const prov = (config.provider || '').toLowerCase();
                if (prov.includes('google') || prov.includes('gemini')) providerId = 'gemini';
                else if (prov.includes('openai')) providerId = 'openai';
                else if (prov.includes('anthropic')) providerId = 'anthropic';
                else providerId = prov || 'cloud';
              }
              return { providerId, modelName: target };
            }
          }

          return { providerId: 'ollama', modelName: target };
        }

        let yamlData: any = {};
        let orchestratorPairs: any[] = [];
        try {
          const routingPaths = [
            join(process.cwd(), 'apps/backend/routing.yaml'),
            join(process.cwd(), 'routing.yaml'),
            join(__dirname, '../../../../routing.yaml'),
          ];
          for (const rPath of routingPaths) {
            if (existsSync(rPath)) {
              const fileContents = readFileSync(rPath, 'utf8');
              yamlData = yaml.load(fileContents) as any;
              if (yamlData && yamlData.orchestrator_pairs) {
                orchestratorPairs = yamlData.orchestrator_pairs;
                break;
              }
            }
          }
        } catch (e) {
          console.error('Failed to load routing.yaml', e);
        }

        if (orchestratorPairs.length === 0) {
          orchestratorPairs = [{ id: 'default-harness', name: 'Default Harness' }];
        }

        const roles = ['preparer', 'planner', 'orchestrator', 'executor', 'qa', 'supervisor'];

        for (const pair of orchestratorPairs) {
          const harnessCode = pair.id || pair.name.toLowerCase().replace(/\s+/g, '-');
          const harnessName = pair.name || pair.id;

          const dh = await HarnessEntity.create({
            code: harnessCode,
            name: harnessName,
            isDefault: true,
            isActive: true,
          });

          for (const role of roles) {
            let targetModelOrProvider = '';
            if (['orchestrator', 'preparer', 'planner', 'supervisor'].includes(role)) {
              targetModelOrProvider = pair.orchestrator || 'cloud_nvidia';
            } else {
              targetModelOrProvider = (pair.subagents && pair.subagents[0]) || 'local_medium';
            }

            const resolved = resolveModelAndProvider(targetModelOrProvider, yamlData);

            await AgentConfigEntity.create({
              code: `${harnessCode}-${role}`,
              harnessId: dh.id,
              role,
              prompt: getDefaultPromptText(role),
              providerId: resolved.providerId,
              modelName: resolved.modelName,
            });
          }
        }
        
        console.log("Default Harnesses seeded successfully on startup.");
      }
    } catch (error) {
      console.error("Unable to connect to the database:", error);
    }
  }
}
