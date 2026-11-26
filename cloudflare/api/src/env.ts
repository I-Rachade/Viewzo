export interface Env {
  DB: D1Database;
  LIVE_READER: DurableObjectNamespace;
  FILES: R2Bucket;
  JWT_SECRET: string;
  DEFAULT_REGION: string;
  FOUNDER_BADGE_LIMIT: string;
  MIN_WITHDRAWAL: string;
}

