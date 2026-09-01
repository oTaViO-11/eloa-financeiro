import { getChatGPTUser } from '@/app/chatgpt-auth';
import { processFinanceMessage } from '@/lib/assistant';
import { ensureUser } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: 'Faça login para conversar com a Eloá.' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { message?: unknown; messageId?: unknown };
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 2_000) {
      return Response.json({ error: 'Envie uma mensagem de até 2.000 caracteres.' }, { status: 400 });
    }
    const messageId =
      typeof body.messageId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(body.messageId)
        ? body.messageId
        : crypto.randomUUID();
    const authenticatedUser = { id: user.userId, displayName: user.displayName, email: user.email };
    await ensureUser(authenticatedUser);
    const reply = await processFinanceMessage({
      user: authenticatedUser,
      text: message,
      source: 'panel',
      messageId,
    });
    return Response.json({ reply, messageId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('panel_message_failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Não foi possível responder agora. Tente novamente.' }, { status: 500 });
  }
}
