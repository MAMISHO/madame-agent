import { Sequelize } from "sequelize-typescript";
import { HarnessEntity } from "./entities/harness.entity";
import { AgentConfigEntity } from "./entities/agent-config.entity";
import { ProviderConfigEntity } from "./entities/provider-config.entity";
import { ExecutionLogEntity } from "./entities/execution-log.entity";
import { join } from "path";

export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: join(process.cwd(), "madame-agent.sqlite"),
  logging: false,
});

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
      ]);
      await sequelize.sync({ force: false });
      console.log("Database models synchronized.");
    } catch (error) {
      console.error("Unable to connect to the database:", error);
    }
  }
}
