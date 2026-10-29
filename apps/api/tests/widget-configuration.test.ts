import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/server.ts';
import { MemoryRepository } from '../src/repository.ts';

for (const configured of [false, true]) test(`widget reports actual saved configuration without exposing values (${configured})`, async () => {
  const env = configured ? {
    N8N_WEBHOOK_URL: 'https://hooks.example.com/webhook/private-id',
    N8N_WEBHOOK_SECRET: 'private-hook-secret',
    ELEVENLABS_AGENT_ID: 'agent-hidden-by-request',
    ELEVENLABS_API_KEY: 'private-voice-secret',
  } : {};
  const response = await handleRequest(new Request('https://ring.test/api/bootstrap', {
    headers: { 'oai-authenticated-user-id': 'owner' },
  }), { TRUST_SITES_HEADERS: 'true', ...env }, new MemoryRepository());
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.whatsapp_widget, {
    webhook_added: configured,
    webhook_auth_added: configured,
    public_key_added: configured,
    voice_added: configured,
  });
  for (const value of Object.values(env)) assert.ok(!JSON.stringify(body.whatsapp_widget).includes(value));
});
