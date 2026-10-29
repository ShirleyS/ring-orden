import homepage from "../showcase/index.html?raw";

export function GET() {
  return new Response(homepage, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
