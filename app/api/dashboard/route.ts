import { getChatGPTUser } from '@/app/chatgpt-auth';
import { dashboard, ensureUser } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: 'Faça login para abrir seu painel.' }, { status: 401 });
  }

  await ensureUser({ id: user.userId, displayName: user.displayName, email: user.email });
  return Response.json(await dashboard(user.userId), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
