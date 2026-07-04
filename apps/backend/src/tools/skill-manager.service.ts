import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { ToolRegistryService } from './tool-registry.service';

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  category?: string;
  tags?: string[];
  status?: 'draft' | 'verified' | 'deprecated';
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  metadata: SkillMetadata;
  embedding?: number[];
}

@Injectable()
export class SkillManagerService implements OnModuleInit {
  private readonly logger = new Logger(SkillManagerService.name);
  private skillsDir: string;
  private skillsMap: Map<string, Skill> = new Map();

  constructor(
    private configService: ConfigService,
    private toolRegistry: ToolRegistryService,
  ) {
    const configuredDir = this.configService.get<string>('tools.skills.directory');
    if (configuredDir) {
      this.skillsDir = path.isAbsolute(configuredDir) 
        ? configuredDir 
        : path.resolve(os.homedir(), '.madame-agent', configuredDir);
    } else {
      this.skillsDir = path.resolve(os.homedir(), '.madame-agent', 'skills');
    }
  }

  async onModuleInit() {
    await this.loadSkills();
    
    // Register search_skills tool
    this.toolRegistry.register({
      definition: {
        type: 'function',
        function: {
          name: 'search_skills',
          description: 'Search for available skills or specialized knowledge that can be passed to subagents.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Optional search query to filter skills. Leave empty to list all skills.'
              }
            }
          }
        }
      },
      execute: async (args: { query?: string }) => {
        const skills = this.listSkills();
        if (skills.length === 0) {
          return { message: 'No skills are currently available in the system.' };
        }
        
        const q = args.query?.trim() || '';
        
        if (!q) {
          return {
            matches: skills.map(s => ({
              name: s.name,
              description: s.description,
              category: s.metadata.category,
              tags: s.metadata.tags,
              status: s.metadata.status
            }))
          };
        }

        let queryEmbedding: number[] | null = null;
        try {
          queryEmbedding = await this.generateEmbedding(q);
        } catch (err) {
          this.logger.warn(`Failed to generate query embedding: ${err}`);
        }

        const scoredSkills = skills.map(s => {
          let score = 0;
          if (queryEmbedding && s.embedding) {
            score = this.cosineSimilarity(queryEmbedding, s.embedding);
          } else {
            // Fallback to text match if embeddings failed
            if (s.name.toLowerCase().includes(q.toLowerCase()) || 
                s.description.toLowerCase().includes(q.toLowerCase()) ||
                (s.metadata.tags && s.metadata.tags.some(tag => tag.toLowerCase().includes(q.toLowerCase())))) {
              score = 0.5;
            }
          }
          return { skill: s, score };
        });

        // Sort by score descending and filter
        scoredSkills.sort((a, b) => b.score - a.score);
        const matches = scoredSkills.filter(s => s.score > 0.3).map(s => ({
          name: s.skill.name,
          description: s.skill.description,
          score: s.score,
          status: s.skill.metadata.status,
          category: s.skill.metadata.category,
          tags: s.skill.metadata.tags
        }));
        
        if (matches.length === 0) {
          return { 
            message: `No skills strongly match '${args.query}'.`, 
            available_skills: skills.map(s => ({ name: s.name, description: s.description })) 
          };
        }
        
        return { matches };
      }
    });
  }

  public async loadSkills() {
    this.skillsMap.clear();
    if (!fs.existsSync(this.skillsDir)) {
      this.logger.warn(`Skills directory not found: ${this.skillsDir}`);
      return;
    }

    try {
      const files = fs.readdirSync(this.skillsDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        
        const name = path.basename(file, '.md');
        const filePath = path.join(this.skillsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        let metadata: SkillMetadata = {
          name,
          description: `Skill: ${name}`
        };

        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
        const match = content.match(frontmatterRegex);
        
        if (match && match[1]) {
          try {
            const parsed = yaml.load(match[1]) as Partial<SkillMetadata>;
            metadata = { ...metadata, ...parsed };
          } catch (e) {
            this.logger.warn(`Invalid YAML frontmatter in skill ${file}`);
          }
        } else {
          // Fallback parsing for description if no frontmatter
          const lines = content.split('\n');
          for (const line of lines) {
            if (line.trim().length > 0 && !line.startsWith('#')) {
              metadata.description = line.trim().slice(0, 100);
              break;
            }
          }
        }

        // Generate embedding text based on description and tags
        const embeddingText = `${metadata.description} ${metadata.tags?.join(' ') || ''}`.trim();
        let embedding: number[] | undefined;
        try {
          embedding = await this.generateEmbedding(embeddingText);
        } catch (err) {
          this.logger.warn(`Could not generate embedding for skill ${name}`);
        }

        this.skillsMap.set(name, {
          name,
          description: metadata.description,
          content,
          metadata,
          embedding
        });
        this.logger.log(`Loaded skill: ${name} (status: ${metadata.status || 'unknown'})`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to load skills from ${this.skillsDir}: ${err.message}`);
    }
  }

  public listSkills(): Skill[] {
    return Array.from(this.skillsMap.values());
  }

  public getSkillContent(name: string): string | null {
    const skill = this.skillsMap.get(name);
    return skill ? skill.content : null;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const embeddingModel = this.configService.get<string>('cache.embeddingModel', 'nomic-embed-text:latest');
    const embeddingBaseUrl = this.configService.get<string>('cache.embeddingBaseUrl', 'http://localhost:11434');
    
    const url = `${embeddingBaseUrl.replace(/\/$/, '')}/api/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: embeddingModel,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API returned ${response.status}`);
    }

    const data = await response.json();
    if (!data.embedding) {
      throw new Error('No embedding returned');
    }
    return data.embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}
