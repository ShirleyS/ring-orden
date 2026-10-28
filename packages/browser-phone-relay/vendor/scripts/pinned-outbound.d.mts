export type PinnedTransport = {
  resolve(host: string): Promise<string[]>;
  fetch(url: string, input: {headers: Record<string,string>; body: string; timeoutMs: number}): Promise<Response>;
};
export function resolvePublic(host: string): Promise<string[]>;
export function createPinnedOutbound(resolve?: (host:string)=>Promise<string[]>, send?: unknown): PinnedTransport;
export function installPinnedOutbound(): void;
