export interface CachedEntry {
  key: string;
  messages: any[];
  response: any;
  embedding: number[];
  timestamp: Date;
  hitCount: number;
  tokensSaved: number;
}

export interface CacheConfig {
  enabled: boolean;
  threshold: number;
  maxEntries: number;
  embeddingModel: string;
  embeddingBaseUrl: string;
}
