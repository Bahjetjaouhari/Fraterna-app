import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * keepalive-push: Silent push notification to wake iOS/Android apps
 * 
 * This function is designed to be called by pg_cron every 2 minutes.
 * It finds users who have tracking_enabled=true but whose heartbeat
 * has gone stale (>2 minutes old), and sends them a silent push
 * notification to wake the app and trigger a fresh heartbeat.
 * 
 * iOS: The silent push wakes the app via didReceiveRemoteNotification
 *      in AppDelegate.swift, which calls sendHeartbeatNow().
 * Android: The data-only FCM message wakes FraternaMessagingService
 *          which can trigger a heartbeat via the foreground service.
 * 
 * SETUP:
 * 1. Deploy: supabase functions deploy keepalive-push
 * 2. Configure pg_cron in Supabase SQL Editor (see migration file)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Base64url encoding (required for JWT)
function base64urlEncode(data: string): string {
  return btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Get OAuth2 access token using Service Account JSON
async function getAccessToken(): Promise<string> {
  const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')

  let clientEmail: string
  let privateKeyId: string
  let privateKey: string

  if (serviceAccountJson) {
    try {
      const sa = JSON.parse(serviceAccountJson)
      clientEmail = sa.client_email
      privateKeyId = sa.private_key_id
      privateKey = sa.private_key
    } catch {
      throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON')
    }
  } else {
    clientEmail = Deno.env.get('FIREBASE_CLIENT_EMAIL')!
    privateKeyId = Deno.env.get('FIREBASE_PRIVATE_KEY_ID')!
    privateKey = Deno.env.get('FIREBASE_PRIVATE_KEY')!
  }

  if (!clientEmail || !privateKeyId || !privateKey) {
    throw new Error('Missing Firebase credentials')
  }

  const formattedKey = privateKey
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '')
    .trim()

  const header = base64urlEncode(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
    kid: privateKeyId,
  }))

  const now = Math.floor(Date.now() / 1000)
  const expiry = now + 3600

  const claim = base64urlEncode(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  }))

  const binaryKey = Uint8Array.from(atob(formattedKey), c => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureInput = `${header}.${claim}`
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signatureInput)
  )

  const signature = base64urlEncode(
    String.fromCharCode(...new Uint8Array(signatureBuffer))
  )

  const jwt = `${header}.${claim}.${signature}`

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    throw new Error(`Failed to get access token: ${error}`)
  }

  const tokenData = await tokenResponse.json()
  return tokenData.access_token
}

// Send a SILENT push notification via FCM v1 API
// Silent = data-only message, no notification payload
// This wakes the app without showing anything to the user
async function sendSilentPush(
  accessToken: string,
  projectId: string,
  token: string,
  platform: 'ios' | 'android'
): Promise<{ success: boolean; error?: string }> {
  try {
    // Build FCM message — data-only (no notification key)
    const message: Record<string, any> = {
      token,
      data: {
        type: 'keepalive',
        timestamp: new Date().toISOString(),
      },
    }

    if (platform === 'ios') {
      // iOS silent push: content-available=1, no alert/sound/badge
      // apns-push-type must be 'background' for silent pushes
      // apns-priority must be '5' (not '10') for background pushes
      message.apns = {
        headers: {
          'apns-push-type': 'background',
          'apns-priority': '5',
        },
        payload: {
          aps: {
            'content-available': 1,
          },
        },
      }
    } else {
      // Android data-only message: high priority to wake from Doze
      message.android = {
        priority: 'high',
      }
    }

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: `${response.status}: ${error}` }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const projectId = Deno.env.get('FIREBASE_PROJECT_ID') || 'fraterna-dca37'

    // Find users who:
    // 1. Have tracking_enabled = true (they want to be tracked)
    // 2. Have a push_token (they can receive pushes)
    // 3. Have a heartbeat older than 2 minutes (stale — need wake up)
    // 4. Have a heartbeat newer than 10 minutes (not fully offline/logged out)
    // This avoids waking users who intentionally turned off tracking
    // or who have been offline for a long time (battery dead, etc.)
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const { data: staleUsers, error } = await supabase
      .from('profiles')
      .select('id, push_token')
      .eq('tracking_enabled', true)
      .not('push_token', 'is', null)
      .lt('last_heartbeat_at', twoMinAgo)
      .gt('last_heartbeat_at', tenMinAgo)

    if (error) {
      console.error('[KEEPALIVE] Error querying stale users:', error)
      return new Response(JSON.stringify({ error: 'Query failed', details: error }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const users = staleUsers || []
    console.log(`[KEEPALIVE] Found ${users.length} stale users to wake`)

    if (users.length === 0) {
      return new Response(JSON.stringify({ success: true, woken: 0, total: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get access token once for all pushes
    const accessToken = await getAccessToken()

    // Send silent pushes to all stale users
    const results = await Promise.allSettled(
      users.map(async (user) => {
        // Detect platform from token format:
        // iOS tokens are typically 64 hex chars
        // Android/FCM tokens are longer and contain colons
        const isIos = user.push_token.length <= 80 && !user.push_token.includes(':')
        const platform = isIos ? 'ios' : 'android'

        const result = await sendSilentPush(accessToken, projectId, user.push_token, platform)
        
        if (!result.success) {
          console.warn(`[KEEPALIVE] Failed for ${user.id.substring(0, 8)}...: ${result.error}`)
          
          // If token is invalid (404 or 400), clear it from the profile
          if (result.error?.includes('404') || result.error?.includes('UNREGISTERED')) {
            console.log(`[KEEPALIVE] Clearing invalid token for ${user.id.substring(0, 8)}...`)
            await supabase
              .from('profiles')
              .update({ push_token: null })
              .eq('id', user.id)
          }
        }

        return { userId: user.id.substring(0, 8), platform, ...result }
      })
    )

    const successful = results.filter(
      (r) => r.status === 'fulfilled' && (r as PromiseFulfilledResult<any>).value.success
    ).length

    console.log(`[KEEPALIVE] Results: ${successful}/${users.length} woken`)

    return new Response(JSON.stringify({
      success: true,
      woken: successful,
      total: users.length,
      results: results.map(r => r.status === 'fulfilled' ? (r as PromiseFulfilledResult<any>).value : { error: 'rejected' }),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[KEEPALIVE] Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
