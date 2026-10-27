import { env } from "cloudflare:workers";
import { handleRequest } from "../../../apps/api/src/server";
import type { RuntimeEnv } from "../../../apps/api/src/auth";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  handleRequest(request, env as RuntimeEnv);
export const POST = (request: Request) =>
  handleRequest(request, env as RuntimeEnv);
export const PATCH = (request: Request) =>
  handleRequest(request, env as RuntimeEnv);
export const DELETE = (request: Request) =>
  handleRequest(request, env as RuntimeEnv);
export const OPTIONS = (request: Request) =>
  handleRequest(request, env as RuntimeEnv);
