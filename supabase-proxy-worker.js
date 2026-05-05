// Cloudflare Worker: Reverse proxy for Supabase API
// This bypasses DNS poisoning of *.supabase.co domains in Venezuela
// Deploy to: fraterna-api.workers.dev or a custom domain

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = 'https://vzlbvknauwvrqwpvtaqe.supabase.co' + url.pathname + url.search;

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'apikey, Authorization, Content-Type, X-Client-Info, Prefer, x-application-name',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Forward the request to Supabase
    const headers = new Headers(request.headers);
    headers.set('Host', 'vzlbvknauwvrqwpvtaqe.supabase.co');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');
    headers.delete('cf-worker');

    // Handle WebSocket upgrades (for Supabase Realtime)
    const upgrade = request.headers.get('Upgrade');
    if (upgrade && upgrade.toLowerCase() === 'websocket') {
      const wsResponse = await fetch(targetUrl, {
        method: request.method,
        headers,
      });
      return wsResponse;
    }

    // Regular HTTP requests
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // Clone the response and add CORS headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Expose-Headers', 'content-range, x-total-count');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};