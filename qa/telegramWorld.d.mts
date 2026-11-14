/* Types for qa/telegramWorld.mjs, so the harness tests typecheck under `tsc` (the world is plain JavaScript and its inferred shapes are too narrow). */
export interface TelegramMessage { chat_id: string; text: string }
export interface WorldWrite { method: string; table: string; query: string; body: any }
export interface World {
  tables: Record<string, any[]>;
  telegram: { mode: 'ok' | '403' | '400' | 'throw'; sent: TelegramMessage[]; attempts: TelegramMessage[] };
  prices: Record<string, number>;
  series?: Record<string, number[]>;
  noKlines?: boolean;
  ohlc?: Record<string, Array<{ o: number; h: number; l: number; c: number; v?: number }>>;
  anchor?: number;
  rpcs?: Array<{ name: string; args: any }>;
  writes: WorldWrite[];
  log: string[];
  [k: string]: any;
}
export function makeWorld(over?: { tables?: Record<string, any[]>; [k: string]: any }): World;
export function installFakeFetch(w: World): void;
export function loadRoute(relPath?: string): Promise<{ run: (secret?: string) => Promise<{ status: number; body: any }> }>;
