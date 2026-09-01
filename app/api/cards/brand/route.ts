import { getChatGPTUser } from '@/app/chatgpt-auth';
import { cardBrandLabel } from '@/lib/card-brand';
import { resolveCardBrand } from '@/lib/card-brand-resolver';
import {
  ensureUser,
  getCardById,
  updateCardBrand,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { error: 'Faça login para identificar a bandeira.' },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    cardId?: unknown;
  };
  const cardId =
    typeof body.cardId === 'string' && /^card_[a-zA-Z0-9-]{8,128}$/.test(body.cardId)
      ? body.cardId
      : null;
  if (!cardId) {
    return Response.json({ error: 'Cartão inválido.' }, { status: 400 });
  }

  await ensureUser({
    id: user.userId,
    displayName: user.displayName,
    email: user.email,
  });
  const card = await getCardById(user.userId, cardId);
  if (!card) {
    return Response.json({ error: 'Cartão não encontrado.' }, { status: 404 });
  }

  const resolution = await resolveCardBrand(card.name, user.userId);
  const updated = await updateCardBrand(
    user.userId,
    card.id,
    resolution.brand,
  );
  return Response.json({
    card: updated,
    found: resolution.brand !== 'unknown',
    label: cardBrandLabel(resolution.brand),
  });
}
