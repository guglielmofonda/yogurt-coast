import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

export type GoogleClient = { client_id: string; client_secret?: string }
export const scopes = ['calendar.calendarlist.readonly', 'calendar.events.readonly'].map(s => `https://www.googleapis.com/auth/${s}`)
export type Token = { access_token: string; expires_in: number; refresh_token?: string; scope?: string }
export class GoogleFailure extends Error {
  constructor(readonly reason: 'setup' | 'storage' | 'cancelled' | 'permission' | 'reconnect' | 'connection') { super(reason) }
}

export function desktopClient(path: string): GoogleClient | undefined {
  try {
    const c = JSON.parse(readFileSync(path, 'utf8')).installed
    if (typeof c?.client_id !== 'string' || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(c.client_id)) return
    return { client_id: c.client_id, ...(typeof c.client_secret === 'string' ? { client_secret: c.client_secret } : {}) }
  } catch { return }
}

export async function tokenRequest(client: GoogleClient, fields: Record<string, string>, request: typeof fetch, signal?: AbortSignal): Promise<Token> {
  const timeout = AbortSignal.timeout(20_000)
  const res = await request('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error',
    body: new URLSearchParams({ ...client, ...fields }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  const body = await res.json()
  if (!res.ok || typeof body.access_token !== 'string') throw new GoogleFailure(body.error === 'invalid_grant' ? 'reconnect' : 'connection')
  if (typeof body.scope === 'string' && !scopes.every(s => body.scope.split(' ').includes(s))) throw new GoogleFailure('permission')
  return { access_token: body.access_token, expires_in: Number(body.expires_in) || 3600, refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : undefined }
}

/** Desktop OAuth uses the system browser and a one-time loopback listener. */
export async function browserGrant(client: GoogleClient, open: (url: string) => Promise<void>, signal: AbortSignal, request: typeof fetch = fetch): Promise<Token> {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url')
  const server = createServer()
  let redirect = ''
  const stop = AbortSignal.any([signal, AbortSignal.timeout(180_000)])
  const code = await new Promise<string>((resolve, reject) => {
    const aborted = () => reject(new GoogleFailure('cancelled'))
    if (stop.aborted) { aborted(); return }
    stop.addEventListener('abort', aborted, { once: true })
    server.on('close', () => stop.removeEventListener('abort', aborted))
    server.once('error', reject)
    server.on('request', (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      const [path, query] = (req.url ?? '').split('?', 2)
      const params = new URLSearchParams(query)
      if (req.method !== 'GET' || `http://${req.headers.host}` !== redirect || path !== '/' || params.get('state') !== state) {
        res.writeHead(400).end('Unrecognized sign-in request.'); return
      }
      const value = params.get('code')
      if (!value || params.has('error')) {
        res.end('Sign-in was cancelled. You can return to Yogurt + Coast.'); reject(new GoogleFailure('cancelled')); return
      }
      res.end('Return to Yogurt + Coast to choose your calendars.')
      resolve(value)
    })
    server.listen(0, '127.0.0.1', () => {
      if (stop.aborted) { server.close(); return }
      const address = server.address()
      if (!address || typeof address === 'string') { reject(new GoogleFailure('connection')); return }
      redirect = `http://127.0.0.1:${address.port}`
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code',
        scope: scopes.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', access_type: 'offline', prompt: 'select_account consent' }).toString()
      void open(url.href).catch(reject)
    })
  }).finally(() => { server.close(); server.closeAllConnections() })
  return tokenRequest(client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }, request, stop)
}
