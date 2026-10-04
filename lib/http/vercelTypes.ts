import type { IncomingMessage, ServerResponse } from 'node:http';

// Node functions receive these helpers from Vercel. Keep their structural
// contract here without installing Vercel's entire function builder for types.
export type VercelRequest = IncomingMessage & {
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
  body: any;
};

export type VercelResponse = ServerResponse & {
  send: (body: any) => VercelResponse;
  json: (body: any) => VercelResponse;
  status: (statusCode: number) => VercelResponse;
  redirect: (statusOrUrl: string | number, url?: string) => VercelResponse;
};
