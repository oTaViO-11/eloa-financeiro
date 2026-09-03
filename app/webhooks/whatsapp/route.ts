import { getRuntimeSecret } from '@/lib/db';
import { normalizePhone } from '@/lib/money';
import {
  findUserByWhatsapp,
  registerWebhookEvent,
  saveWebhookReply,
} from '@/lib/store';
import { processFinanceMessage } from '@/lib/assistant';

export const dynamic = 'force-dynamic';

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

async function validSignature(body: ArrayBuffer, signature: string | null): Promise<boolean> {
  const secret = getRuntimeSecret('WHATSAPP_APP_SECRET');
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, body);
  const computed = Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return safeEqual(computed, signature.slice('sha256='.length));
}

async function sendWhatsAppText(to: string, body: string): Promise<void> {
  const token = getRuntimeSecret('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = getRuntimeSecret('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneNumberId) throw new Error('A integração com WhatsApp ainda não foi concluída.');
  const version = getRuntimeSecret('WHATSAPP_GRAPH_API_VERSION') ?? 'v26.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: body.slice(0, 4096) },
    }),
  });
  if (!response.ok) throw new Error(`A Meta recusou a resposta (${response.status}).`);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const mode = query.get('hub.mode');
  const token = query.get('hub.verify_token');
  const challenge = query.get('hub.challenge');
  const expected = getRuntimeSecret('WHATSAPP_VERIFY_TOKEN');
  if (mode === 'subscribe' && token && expected && safeEqual(token, expected) && challenge) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.arrayBuffer();
  if (!(await validSignature(rawBody, request.headers.get('x-hub-signature-256')))) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: RecordValue | null = null;
  try {
    payload = asRecord(JSON.parse(new TextDecoder().decode(rawBody)));
  } catch {
    return new Response('Invalid payload', { status: 400 });
  }
  if (!payload) return new Response('Invalid payload', { status: 400 });

  const allowed = new Set(strings(getRuntimeSecret('WHATSAPP_ALLOWED_NUMBERS')?.split(',').map((value) => value.trim())));
  const configuredPhoneId = getRuntimeSecret('WHATSAPP_PHONE_NUMBER_ID');
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const entryRecord = asRecord(entry);
    const changes = entryRecord && Array.isArray(entryRecord.changes) ? entryRecord.changes : [];
    for (const change of changes) {
      const changeRecord = asRecord(change);
      if (!changeRecord || changeRecord.field !== 'messages') continue;
      const value = asRecord(changeRecord.value);
      const metadata = value && asRecord(value.metadata);
      if (configuredPhoneId && metadata?.phone_number_id !== configuredPhoneId) continue;
      const messages = value && Array.isArray(value.messages) ? value.messages : [];
      for (const item of messages) {
        const message = asRecord(item);
        const text = message && asRecord(message.text);
        const providerMessageId = message && typeof message.id === 'string' ? message.id : null;
        const rawFrom = message && typeof message.from === 'string' ? message.from : null;
        const content = text && typeof text.body === 'string' ? text.body.trim() : '';
        if (!providerMessageId || !rawFrom || !content) continue;
        let from: string;
        try {
          from = normalizePhone(rawFrom);
        } catch {
          continue;
        }
        if (allowed.size && !allowed.has(from)) continue;
        const inserted = await registerWebhookEvent(providerMessageId, from, JSON.stringify(message));
        if (!inserted) continue;
        const user = await findUserByWhatsapp(from);
        if (!user) continue;
        try {
          const result = await processFinanceMessage({
            user,
            text: content,
            source: 'whatsapp',
            messageId: providerMessageId,
          });
          await sendWhatsAppText(from, result.reply);
          if (!result.didReset) {
            await saveWebhookReply(providerMessageId, result.reply);
          }
        } catch (error) {
          console.error('whatsapp_message_failed', error instanceof Error ? error.message : 'unknown');
        }
      }
    }
  }
  return new Response('EVENT_RECEIVED', { status: 200 });
}
