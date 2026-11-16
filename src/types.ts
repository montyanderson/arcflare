export interface Env {
  DB: D1Database;
  SITE_NAME?: string;
  SITE_DESCRIPTION?: string;
}
export interface User {
  id: string; password: string; created: number; karma: number;
  about: string; email: string; role: 'user' | 'editor' | 'admin'; banned: number;
}
export interface Item {
  id: number; type: 'story' | 'comment' | 'poll' | 'pollopt'; by: string;
  time: number; title: string; url: string; text: string; parent: number | null;
  root: number | null; score: number; dead: number; deleted: number;
  comments?: number; voted?: number; saved?: number; flags?: number;
}
export interface Context { env: Env; request: Request; url: URL; user: User | null; csrf: string; }
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const now = () => Math.floor(Date.now() / 1000);
export const editor = (user: User | null) => !!user && ['editor','admin'].includes(user.role);
