// Node-only transport. Imported only by the self-host startup, never Worker bundles.
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';
import { checkWebhookUrl, isPrivateAddress } from '../src/lib/shared/net.ts';

export async function resolvePublic(host) {
  const records = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  const addresses = records.map(r => r.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('Private or unresolved destination');
  return addresses;
}

export function createPinnedOutbound(resolve = resolvePublic, send = request) {
  return {
    resolve,
    async fetch(raw, { headers, body, timeoutMs }) {
      const checked = checkWebhookUrl(raw);
      if (!checked.ok || checked.url.protocol !== 'https:') throw new Error('Unsafe destination');
      const url = checked.url;
      const host = url.hostname.replace(/^\[|\]$/g, '');
      // Validate EVERY address, then freeze one address for this request. Never
      // pass original hostname through an OS resolver at socket connection time.
      const addresses = await resolve(host);
      if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('Private destination');
      const address = addresses[0];
      if (!address || !isIP(address)) throw new Error('Invalid address');
      return new Promise((resolveResponse, reject) => {
        let settled = false;
        const finish = (error, response) => {
          if (settled) return; settled = true; clearTimeout(timer);
          if (error) reject(error); else resolveResponse(response);
        };
        const req = send({
          protocol: 'https:', hostname: host, port: url.port || 443, path: url.pathname + url.search,
          method: 'POST', agent: false, rejectUnauthorized: true,
          servername: isIP(host) ? '' : host,
          checkServerIdentity: (_name, cert) => checkServerIdentity(host, cert),
          lookup: (_name, options, callback) => {
            const family = isIP(address);
            if (options?.all) callback(null, [{ address, family }]);
            else callback(null, address, family);
          },
          headers: { ...headers, Host: url.host, 'Content-Length': Buffer.byteLength(body) },
        }, res => {
          if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); finish(null, new Response(null, { status: res.statusCode })); return; }
          const chunks = []; let bytes = 0;
          res.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > 65536) { res.destroy(); req.destroy(); finish(new Error('response_too_large')); return; }
            chunks.push(chunk);
          });
          res.on('end', () => {
            try {
              const status = res.statusCode || 502;
              const responseBody = status === 204 || status === 205 ? null : Buffer.concat(chunks);
              finish(null, new Response(responseBody, { status }));
            } catch (error) {
              finish(error);
            }
          });
          res.on('error', e => finish(e));
        });
        const timer = setTimeout(() => { req.destroy(); finish(new Error('timeout')); }, timeoutMs);
        req.on('error', e => finish(e));
        req.end(body);
      });
    },
  };
}

export function installPinnedOutbound() {
  if (process.release.name !== 'node' || typeof process.versions.node !== 'string') throw new Error('Native Node required');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must not be disabled');
  globalThis[Symbol.for('browser-phone.node-pinned-outbound.v1')] = createPinnedOutbound();
}
