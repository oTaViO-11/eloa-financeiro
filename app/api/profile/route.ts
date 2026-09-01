import { getChatGPTUser } from '@/app/chatgpt-auth';
import { normalizePhone } from '@/lib/money';
import { ensureUser, updateProfile } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: 'Faça login para salvar seus dados.' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { whatsappNumber?: unknown };
    const rawNumber = typeof body.whatsappNumber === 'string' ? body.whatsappNumber : '';
    await ensureUser({ id: user.userId, displayName: user.displayName, email: user.email });
    const profile = await updateProfile(user.userId, {
      whatsappNumber: rawNumber.trim() ? normalizePhone(rawNumber) : null,
    });
    return Response.json({ profile }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível atualizar seu perfil.';
    return Response.json({ error: message }, { status: 400 });
  }
}
