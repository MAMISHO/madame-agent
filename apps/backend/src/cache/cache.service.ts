import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CachedEntry, CacheConfig } from './cache.interface';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly config: CacheConfig;
  private entries: CachedEntry[] = [];

  constructor(private configService: ConfigService) {
    this.config = {
      enabled: this.configService.get<boolean>('cache.enabled', false),
      threshold: this.configService.get<number>('cache.threshold', 0.92),
      maxEntries: this.configService.get<number>('cache.maxEntries', 500),
      embeddingModel: this.configService.get<string>('cache.embeddingModel', 'nomic-embed-text:latest'),
      embeddingBaseUrl: this.configService.get<string>('cache.embeddingBaseUrl', 'http://localhost:11434'),
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const url = `${this.config.embeddingBaseUrl.replace(/\/$/, '')}/api/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.warn(`Embedding API error (${response.status}): ${errText} — returning zero vector`);
      return new Array(768).fill(0);
    }

    const data = await response.json();
    if (!data.embedding) {
      this.logger.warn('Embedding API returned no embedding — returning zero vector');
      return new Array(768).fill(0);
    }
    return data.embedding;
  }

  async findSimilar(input: string, threshold?: number): Promise<CachedEntry | null> {
    if (!this.config.enabled || this.entries.length === 0) return null;

    const effectiveThreshold = threshold ?? this.config.threshold;
    let inputEmbedding: number[];
    try {
      inputEmbedding = await this.generateEmbedding(input);
    } catch (err: any) {
      this.logger.warn(`Cache lookup failed: ${err.message} — treating as MISS`);
      return null;
    }

    let bestMatch: CachedEntry | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries) {
      const similarity = this.cosineSimilarity(inputEmbedding, entry.embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch && bestSimilarity >= effectiveThreshold) {
      bestMatch.hitCount++;
      this.logger.log(
        `Cache HIT: similarity=${bestSimilarity.toFixed(4)} (threshold=${effectiveThreshold}) for "${input.slice(0, 60)}..."`,
      );
      return bestMatch;
    }

    this.logger.debug(
      `Cache MISS: best similarity=${bestSimilarity.toFixed(4)} < threshold=${effectiveThreshold}`,
    );
    return null;
  }

  async store(
    messages: any[],
    response: any,
    tokensSaved: number = 0,
  ): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const text = JSON.stringify(messages);
      const embedding = await this.generateEmbedding(text);

      if (this.entries.length >= this.config.maxEntries) {
        const oldest = this.entries.reduce((a, b) =>
          a.hitCount <= b.hitCount ? a : b,
        );
        const idx = this.entries.indexOf(oldest);
        this.entries.splice(idx, 1);
      }

      const entry: CachedEntry = {
        key: `cache_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        messages,
        response,
        embedding,
        timestamp: new Date(),
        hitCount: 0,
        tokensSaved,
      };

      this.entries.push(entry);
      this.logger.debug(`Cache stored: ${entry.key} (${this.entries.length} entries)`);
    } catch (err: any) {
      this.logger.warn(`Failed to cache response: ${err.message} — continuing without cache`);
    }
  }

  getStats(): { entries: number; hits: number; totalSaved: number } {
    let hits = 0;
    let totalSaved = 0;
    for (const e of this.entries) {
      hits += e.hitCount;
      totalSaved += e.tokensSaved;
    }
    return { entries: this.entries.length, hits, totalSaved };
  }

  clear(): void {
    this.entries = [];
    this.logger.log('Cache cleared');
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
