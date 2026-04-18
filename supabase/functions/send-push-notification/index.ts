import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PushMessage {
  token: string
  title: string
  body: string
  type: string
  data?: Record<string, string>
}

// Get the appropriate notification channel based on notification type
function getChannelId(type: string): string {
  switch (type) {
    case 'emergency_message':
      return 'emergency'
    case 'global_message':
    case 'friend_request':
    case 'friend_accepted':
      return 'messages'
    default:
      return 'default'
  }
}

// Base64url encoding (required for JWT - standard btoa is NOT base64url)
function base64urlEncode(data: string): string {
  return btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Get OAuth2 access token using Service Account JSON
async function getAccessToken(): Promise<string> {
  // Try FIREBASE_SERVICE_ACCOUNT JSON first (recommended approach)
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
      console.log('[AUTH] Using FIREBASE_SERVICE_ACCOUNT JSON for', clientEmail)
    } catch {
      console.error('[AUTH] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON')
      throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT JSON')
    }
  } else {
    // Fallback to individual env vars
    clientEmail = Deno.env.get('FIREBASE_CLIENT_EMAIL')!
    privateKeyId = Deno.env.get('FIREBASE_PRIVATE_KEY_ID')!
    privateKey = Deno.env.get('FIREBASE_PRIVATE_KEY')!
    console.log('[AUTH] Using individual env vars for', clientEmail)
  }

  if (!clientEmail || !privateKeyId || !privateKey) {
    throw new Error('Missing Firebase credentials')
  }

  // Format private key
  const formattedKey = privateKey
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\n/g, '')
    .trim()

  // Build JWT with PROPER base64url encoding
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

  // Import the private key
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

  console.log('[AUTH] JWT generated, exchanging for access token...')

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text()
    console.error('[AUTH] Token exchange failed:', tokenResponse.status, error)
    throw new Error(`Failed to get access token: ${error}`)
  }

  const tokenData = await tokenResponse.json()
  console.log('[AUTH] Access token obtained successfully, expires in:', tokenData.expires_in, 's')
  return tokenData.access_token
}

// Send FCM notification using HTTP v1 API
async function sendFCMMessage(message: PushMessage): Promise<{ success: boolean; error?: string }> {
  try {
    const accessToken = await getAccessToken()
    const projectId = Deno.env.get('FIREBASE_PROJECT_ID') || 'fraterna-dca37'

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: {
              title: message.title,
              body: message.body,
            },
            data: {
              ...message.data,
              title: message.title,
              body: message.body,
            },
            android: {
              priority: 'high',
              notification: {
                channel_id: getChannelId(message.type),
                sound: 'default',
                default_sound: true,
                default_vibrate_timings: true,
                default_light_settings: true,
              },
            },
            apns: {
              headers: {
                'apns-push-type': 'alert',
                'apns-priority': '10',
              },
              payload: {
                aps: {
                  alert: {
                    title: message.title,
                    body: message.body,
                  },
                  sound: 'default',
                  badge: 1,
                  'content-available': 1,
                },
              },
            },
          },
        }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('FCM v1 error:', response.status, error)
      return { success: false, error: `${response.status}: ${error}` }
    }

    const result = await response.json()
    console.log('FCM v1 success:', result)
    return { success: true }
  } catch (error) {
    console.error('FCM send error:', error)
    return { success: false, error: String(error) }
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { type, data } = body

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const notifications: PushMessage[] = []

    // Helper to get sender name
    const getSenderName = async (userId: string): Promise<string> => {
      const { data: sender } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .single()
      return sender?.full_name || 'Un QH'
    }

    // ========================================
    // EMERGENCY MESSAGE - Same city users
    // ========================================
    if (type === 'emergency_message') {
      const { message, city, user_id } = data

      console.log('[EMERGENCY] Processing:', { message, city, user_id })

      let query = supabase
        .from('profiles')
        .select('id, push_token, full_name, city')
        .not('push_token', 'is', null)
        .neq('id', user_id)

      if (city) {
        query = query.ilike('city', city)
      }

      const { data: users, error: usersError } = await query

      if (usersError) {
        console.error('[EMERGENCY] Error fetching users:', usersError)
        return new Response(JSON.stringify({ error: 'Failed to fetch users', details: usersError }), {
          status: 500,
          headers: corsHeaders,
        })
      }

      console.log('[EMERGENCY] Found users:', users?.length || 0)

      const senderName = await getSenderName(user_id)

      for (const user of users || []) {
        if (user.push_token) {
          notifications.push({
            token: user.push_token,
            title: '🚨 Alerta de Emergencia',
            body: `${senderName}: ${message}`,
            type: 'emergency_message',
            data: {
              type: 'emergency_message',
              city: city || '',
              sender_id: user_id,
            },
          })
        }
      }
    }

    // ========================================
    // GLOBAL CHAT MESSAGE - All users
    // ========================================
    else if (type === 'global_message') {
      const { message, user_id } = data

      console.log('[GLOBAL] Processing message from:', user_id)

      const { data: users, error: usersError } = await supabase
        .from('profiles')
        .select('id, push_token, full_name')
        .not('push_token', 'is', null)
        .neq('id', user_id)

      if (usersError) {
        console.error('[GLOBAL] Error fetching users:', usersError)
        return new Response(JSON.stringify({ error: 'Failed to fetch users', details: usersError }), {
          status: 500,
          headers: corsHeaders,
        })
      }

      console.log('[GLOBAL] Found users:', users?.length || 0)

      const senderName = await getSenderName(user_id)
      const messagePreview = message.length > 50 ? message.substring(0, 50) + '...' : message

      for (const user of users || []) {
        if (user.push_token) {
          notifications.push({
            token: user.push_token,
            title: '💬 Chat Global',
            body: `${senderName}: ${messagePreview}`,
            type: 'global_message',
            data: {
              type: 'global_message',
              sender_id: user_id,
            },
          })
        }
      }
    }

    // ========================================
    // FRIEND REQUEST - Notify the recipient
    // ========================================
    else if (type === 'friend_request') {
      const { from_user_id, to_user_id } = data

      console.log('[FRIEND_REQUEST] From:', from_user_id, 'To:', to_user_id)

      // Get recipient's push token
      const { data: recipient, error: recipientError } = await supabase
        .from('profiles')
        .select('push_token, full_name')
        .eq('id', to_user_id)
        .single()

      if (recipientError) {
        console.error('[FRIEND_REQUEST] Error fetching recipient:', recipientError)
        return new Response(JSON.stringify({ error: 'Failed to fetch recipient' }), {
          status: 500,
          headers: corsHeaders,
        })
      }

      const senderName = await getSenderName(from_user_id)

      if (recipient?.push_token) {
        notifications.push({
          token: recipient.push_token,
          title: '👋 Nueva solicitud de amistad',
          body: `${senderName} quiere ser tu amigo`,
          type: 'friend_request',
          data: {
            type: 'friend_request',
            sender_id: from_user_id,
          },
        })
      }

      console.log('[FRIEND_REQUEST] Notifications to send:', notifications.length)
    }

    // ========================================
    // FRIEND REQUEST ACCEPTED - Notify the original sender
    // ========================================
    else if (type === 'friend_accepted') {
      const { from_user_id, to_user_id } = data

      console.log('[FRIEND_ACCEPTED] From:', from_user_id, 'To:', to_user_id)

      // Get the original requester's push token
      const { data: requester, error: requesterError } = await supabase
        .from('profiles')
        .select('push_token, full_name')
        .eq('id', to_user_id)  // to_user_id is the one who accepted
        .single()

      if (requesterError) {
        console.error('[FRIEND_ACCEPTED] Error fetching requester:', requesterError)
        return new Response(JSON.stringify({ error: 'Failed to fetch requester' }), {
          status: 500,
          headers: corsHeaders,
        })
      }

      const accepterName = await getSenderName(from_user_id)

      if (requester?.push_token) {
        notifications.push({
          token: requester.push_token,
          title: '✅ Solicitud aceptada',
          body: `${accepterName} aceptó tu solicitud de amistad`,
          type: 'friend_accepted',
          data: {
            type: 'friend_accepted',
            sender_id: from_user_id,
          },
        })
      }

      console.log('[FRIEND_ACCEPTED] Notifications to send:', notifications.length)
    }

    // ========================================
    // TEST NOTIFICATION - For debugging
    // ========================================
    else if (type === 'test') {
      const { token, title, body } = data

      console.log('[TEST] Sending test notification to:', token?.substring(0, 20))

      if (!token) {
        return new Response(JSON.stringify({ error: 'Token required for test' }), {
          status: 400,
          headers: corsHeaders,
        })
      }

      notifications.push({
        token: token,
        title: title || '🧪 Test de Notificación',
        body: body || 'Si ves esto, las notificaciones funcionan correctamente',
        type: 'test',
        data: {
          type: 'test',
        },
      })
    }

    // ========================================
    // UNKNOWN TYPE
    // ========================================
    else {
      console.error('[UNKNOWN] Type:', type)
      return new Response(JSON.stringify({ error: 'Unknown notification type' }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    // ========================================
    // SEND NOTIFICATIONS
    // ========================================
    console.log(`[SEND] Sending ${notifications.length} notifications`)

    const results = await Promise.allSettled(
      notifications.map(async (notification) => {
        const result = await sendFCMMessage(notification)
        return { token: notification.token.substring(0, 20) + '...', ...result }
      })
    )

    const successful = results.filter(
      (r) => r.status === 'fulfilled' && (r as PromiseFulfilledResult<any>).value.success
    ).length

    console.log(`[SEND] Results: ${successful}/${notifications.length} sent`)

    return new Response(JSON.stringify({
      success: true,
      sent: successful,
      total: notifications.length,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[ERROR] Error in send-push-notification:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    })
  }
})