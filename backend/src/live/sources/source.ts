import type { EventEmitter } from 'node:events';

export interface SourceStatus {
  state: 'connected' | 'disconnected' | 'ended' | 'error';
  message: string;
}

/**
 * Where a live's comments come from. Emits "comment" (LiveCommentIn),
 * "viewers" (number) and "status" (SourceStatus).
 */
export interface CommentSource extends EventEmitter {
  start(): Promise<void>;
  stop(): void;
}
