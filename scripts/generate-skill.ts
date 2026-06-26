import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProvidersService } from '../src/providers/providers.service';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  if (process.argv.length < 3) {
    console.error('Usage: npm run generate-skill <path-to-source-file> [skill-name]');
    process.exit(1);
  }

  const sourcePath = process.argv[2];
  const customName = process.argv[3];
  
  if (!fs.existsSync(sourcePath)) {
    console.error(`Error: File not found at ${sourcePath}`);
    process.exit(1);
  }

  const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
  const baseName = customName || path.basename(sourcePath, path.extname(sourcePath)).toLowerCase();

  const app = await NestFactory.createApplicationContext(AppModule);
  const providersService = app.get(ProvidersService);
  const configService = app.get(ConfigService);
  
  const providerKey = configService.get<string>('routing.orchestrator', 'cloud');
  const provider = providersService.getProvider(providerKey);

  if (!provider) {
    console.error(`Error: Orchestrator provider '${providerKey}' not found.`);
    await app.close();
    process.exit(1);
  }

  console.log(`Generating skill '${baseName}' from ${sourcePath} using provider '${providerKey}'...`);

  const prompt = `You are a technical documentation assistant. 
I am providing you with the source code/types for a module.
Your task is to generate a Markdown "Skill" file that will be used by an AI agent to understand how to use this module.
The skill MUST include a YAML frontmatter block at the very top.

Required Frontmatter Format:
---
name: "${baseName}"
description: "A short, 1-sentence description of what this API/module does."
version: "1.0.0"
category: "API Reference"
tags: ["auto-generated", "sdk", "types"]
status: "verified"
---

Following the frontmatter, write a Markdown guide explaining the core types, functions, and best practices for using this module based ONLY on the provided source code. Include code examples if possible.

Source Code:
\`\`\`
${sourceContent}
\`\`\`
`;

  try {
    const modelConfig = configService.get('routing.models.' + providerKey, {});
    const response = await provider.chat(
      {
        model: modelConfig.model || 'default',
        messages: [{ role: 'user', content: prompt }]
      },
      modelConfig
    );

    let finalContent = response.data?.choices?.[0]?.message?.content || '';

    const outDir = path.resolve(process.cwd(), 'skills');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const outPath = path.join(outDir, `${baseName}.md`);
    
    // Clean up markdown block if the model wrapped the whole response in ```markdown
    if (finalContent.startsWith('```markdown\n')) {
      finalContent = finalContent.replace(/^```markdown\n/, '').replace(/\n```$/, '');
    }

    fs.writeFileSync(outPath, finalContent, 'utf-8');
    console.log(`✅ Skill successfully generated and saved to ${outPath}`);
    
  } catch (error: any) {
    console.error(`Error generating skill: ${error.message}`);
  } finally {
    await app.close();
  }
}

bootstrap();
