'use client';

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  ReceiptText,
  Send,
  Settings2,
  WalletCards,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cardBrandLabel, normalizeCardBrand } from '@/lib/card-brand';
import { purchaseCategoryLabel } from '@/lib/categories';

type Profile = {
  whatsappNumber: string | null;
  monthlyIncomeCents: number;
  fixedExpensesCents: number;
  savingsGoalCents: number;
  monthlyBudgetCents: number;
};

type CardItem = {
  id: string;
  name: string;
  brand: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  outstandingCents?: number;
  availableCents?: number;
};

type Purchase = {
  id: string;
  description: string;
  merchant: string | null;
  category: string;
  totalCents: number;
  paymentMethod: string;
  cardName: string | null;
  purchasedAt: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source: string;
  createdAt: string;
};

type DashboardData = {
  profile: Profile;
  effectiveBudgetCents: number;
  spendingCents: number;
  cards: CardItem[];
  purchases: Purchase[];
  messages: ChatMessage[];
};

type ApiError = { error?: string };

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
});

function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

function paymentLabel(method: string): string {
  const labels: Record<string, string> = {
    pix: 'Pix',
    credit: 'Crédito',
    debit: 'Débito',
    cash: 'Dinheiro',
  };
  return labels[method] ?? method;
}

function purchaseDescriptionWithoutPayment(description: string): string {
  const cleaned = description
    .replace(
      /\s+(?:no|na|com|via)\s+(?:pix|dinheiro|d[eé]bito|(?:cart[aã]o\s+de\s+)?cr[eé]d(?:ito|tio)|cart[aã]o(?:\s+[\p{L}][\p{L}\d .-]{1,48})?)(?:\s+(?:no|na)\s+[\p{L}][\p{L}\d .-]{1,48})?$/iu,
      '',
    )
    .trim();
  return cleaned || description;
}

function messageTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(parsed);
}

function safeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok)
    throw new Error(payload.error ?? 'Não foi possível concluir a ação.');
  return payload;
}

export function FinanceDashboard({ displayName }: { displayName: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [resolvingBrandCardId, setResolvingBrandCardId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const next = await readJson<DashboardData>(
        await fetch('/api/dashboard', { cache: 'no-store' }),
      );
      setData(next);
      setPhone(next.profile.whatsappNumber ?? '');
      setNotice(null);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Não foi possível abrir seu painel.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const scrollMessagesToBottom = useCallback(() => {
    const element = messageListRef.current;
    if (!element || !shouldStickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(scrollMessagesToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [data?.messages, sending, scrollMessagesToBottom]);

  function handleMessageScroll() {
    const element = messageListRef.current;
    if (!element) return;
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 64;
  }

  const budgetPercent = useMemo(() => {
    if (!data?.effectiveBudgetCents) return 0;
    return Math.min(
      100,
      Math.round((data.spendingCents / data.effectiveBudgetCents) * 100),
    );
  }, [data]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = message.trim();
    if (!content || sending) return;
    const messageId = safeId();
    const createdAt = new Date().toISOString();
    shouldStickToBottomRef.current = true;
    setMessage('');
    setSending(true);
    setNotice(null);
    setData((current) =>
      current
        ? {
            ...current,
            messages: [
              ...current.messages,
              {
                id: `${messageId}-user`,
                role: 'user',
                content,
                source: 'panel',
                createdAt,
              },
            ],
          }
        : current,
    );
    try {
      const result = await readJson<{ reply: string }>(
        await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content, messageId }),
        }),
      );
      setData((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: `${messageId}-assistant`,
                  role: 'assistant',
                  content: result.reply,
                  source: 'panel',
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : current,
      );
      void loadDashboard();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Não foi possível enviar sua mensagem.',
      );
    } finally {
      setSending(false);
    }
  }

  async function savePhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPhone) return;
    setSavingPhone(true);
    setNotice(null);
    try {
      const result = await readJson<{ profile: Profile }>(
        await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ whatsappNumber: phone }),
        }),
      );
      setData((current) =>
        current ? { ...current, profile: result.profile } : current,
      );
      setPhone(result.profile.whatsappNumber ?? '');
      setNotice(
        'Número salvo. Quando o WhatsApp estiver conectado, a Eloá reconhecerá suas mensagens.',
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o número.',
      );
    } finally {
      setSavingPhone(false);
    }
  }

  async function identifyCardBrand(cardId: string) {
    if (resolvingBrandCardId) return;
    setResolvingBrandCardId(cardId);
    setNotice(null);
    try {
      const result = await readJson<{ found: boolean; label: string }>(
        await fetch('/api/cards/brand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId }),
        }),
      );
      await loadDashboard();
      setNotice(
        result.found
          ? `Bandeira identificada: ${result.label}.`
          : 'Não encontrei uma bandeira única com segurança. Você pode informar a bandeira ao cadastrar o cartão novamente.',
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Não foi possível identificar a bandeira agora.',
      );
    } finally {
      setResolvingBrandCardId(null);
    }
  }

  function startCardCorrection(cardName: string) {
    setMessage(`Corrigir bandeira do cartão ${cardName} para `);
    window.requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  const empty = !loading && data && data.messages.length === 0;
  const initialLoading = loading && !data;

  return (
    <main className="min-h-screen bg-[#f5f6f1] text-[#143b32]">
      <header className="border-b border-[#d9e0d4] bg-[#fbfcf8]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#174f40] text-white shadow-sm">
              <WalletCards size={20} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#5c756e]">
                Eloá
              </p>
              <h1 className="font-serif text-xl leading-none tracking-tight">
                Seu financeiro pessoal
              </h1>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#d9e0d4] bg-white px-3 py-2 text-sm text-[#47645c] sm:flex">
            <LockKeyhole size={14} /> Dados só seus
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,.85fr)]">
        <section className="space-y-6">
          <div className="rounded-[2rem] bg-[#174f40] px-6 py-7 text-[#f7faf5] shadow-[0_20px_60px_rgba(20,66,53,.16)] sm:px-8">
            <p className="text-sm text-[#c9ddd3]">
              Olá, {displayName.split(' ')[0]}.
            </p>
            <h2 className="mt-2 max-w-xl font-serif text-3xl leading-tight sm:text-4xl">
              Suas decisões financeiras, uma conversa de cada vez.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d7e5de]">
              Registre gastos, consulte o cartão e ajuste o seu plano usando
              mensagens simples. Nada é salvo sem a sua confirmação.
            </p>
          </div>

          {notice && (
            <p
              role="status"
              className="rounded-xl border border-[#ead8a0] bg-[#fff9e8] px-4 py-3 text-sm text-[#725d1e]"
            >
              {notice}
            </p>
          )}

          <section
            className="grid gap-4 sm:grid-cols-3"
            aria-label="Resumo mensal"
          >
            <MetricCard
              title="Orçamento do mês"
              value={
                loading ? '—' : formatMoney(data?.effectiveBudgetCents ?? 0)
              }
              icon={<WalletCards size={18} />}
              tone="green"
            />
            <MetricCard
              title="Já registrado"
              value={loading ? '—' : formatMoney(data?.spendingCents ?? 0)}
              icon={<ReceiptText size={18} />}
              tone="cream"
            />
            <MetricCard
              title="Disponível"
              value={
                loading
                  ? '—'
                  : formatMoney(
                      (data?.effectiveBudgetCents ?? 0) -
                        (data?.spendingCents ?? 0),
                    )
              }
              icon={<ArrowDownRight size={18} />}
              tone="light"
            />
          </section>

          <Card className="overflow-hidden border-[#d9e0d4] bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between border-b border-[#e6ebe2] pb-4">
              <div>
                <CardTitle className="font-serif text-2xl text-[#143b32]">
                  Converse com a Eloá
                </CardTitle>
                <p className="mt-1 text-sm text-[#668078]">
                  Diga o que comprou ou pergunte se algo cabe no crédito.
                </p>
              </div>
              <Bot className="text-[#174f40]" />
            </CardHeader>
            <CardContent className="p-0">
              <div
                ref={messageListRef}
                onScroll={handleMessageScroll}
                className="max-h-[430px] min-h-[280px] space-y-3 overflow-y-auto overscroll-contain bg-[#fafcf9] p-5 [overflow-anchor:none]"
                aria-live="polite"
              >
                {initialLoading && (
                  <div className="flex h-52 items-center justify-center gap-2 text-sm text-[#668078]">
                    <LoaderCircle className="animate-spin" size={17} /> Abrindo
                    seu painel…
                  </div>
                )}
                {empty && <WelcomeMessage />}
                {data?.messages.map((item) => (
                  <Bubble key={item.id} message={item} />
                ))}
                {sending && (
                  <div className="w-fit rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-sm text-[#668078] shadow-sm">
                    <LoaderCircle
                      className="mr-2 inline animate-spin"
                      size={14}
                    />{' '}
                    Pensando…
                  </div>
                )}
              </div>
              <form
                onSubmit={sendMessage}
                className="border-t border-[#e6ebe2] bg-white p-4"
              >
                <label htmlFor="finance-message" className="sr-only">
                  Mensagem para Eloá
                </label>
                <div className="flex items-end gap-3">
                  <textarea
                    id="finance-message"
                    ref={messageInputRef}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Ex.: Comprei mercado por R$ 85 no Pix"
                    maxLength={2000}
                    rows={2}
                    className="min-h-12 flex-1 resize-none rounded-xl border border-[#cfdad1] bg-[#fcfdfb] px-3 py-2.5 text-sm text-[#143b32] outline-none transition focus:border-[#174f40] focus:ring-2 focus:ring-[#174f40]/15"
                  />
                  <Button
                    type="submit"
                    disabled={!message.trim() || sending}
                    className="h-11 rounded-xl bg-[#174f40] px-4 text-white hover:bg-[#123f33]"
                  >
                    <Send size={16} />
                    <span className="sr-only sm:not-sr-only sm:ml-1">
                      Enviar
                    </span>
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    'Meus dados',
                    'Atualizar dados',
                    'Minha renda é R$ 2.500 e orçamento R$ 700',
                    'Cartão Nubank, limite R$ 1.500, fecha dia 5 e vence dia 12',
                    'Posso comprar algo de R$ 300 no crédito?',
                  ].map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setMessage(example)}
                      className="rounded-full border border-[#d9e0d4] px-3 py-1.5 text-left text-xs text-[#47645c] transition hover:border-[#174f40] hover:text-[#174f40]"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </form>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-5">
          <Card className="border-[#d9e0d4] bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard size={18} /> Seus cartões
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading && (
                <p className="text-sm text-[#668078]">Carregando cartões…</p>
              )}
              {!loading && !data?.cards.length && (
                <p className="text-sm leading-6 text-[#668078]">
                  Cadastre um cartão pelo chat para analisar compras no crédito.
                </p>
              )}
              {data?.cards.map((card) => {
                const used = card.outstandingCents ?? 0;
                const brand = normalizeCardBrand(card.brand);
                const available =
                  card.availableCents ?? Math.max(0, card.limitCents - used);
                const percentage = card.limitCents
                  ? Math.min(100, Math.round((used / card.limitCents) * 100))
                  : 0;
                return (
                  <div
                    key={card.id}
                    className="rounded-2xl border border-[#e1e7df] bg-[#fbfcf9] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block text-sm">{card.name}</strong>
                        <span className="mt-1 inline-flex rounded-full bg-[#edf1ee] px-2 py-0.5 text-[11px] font-semibold text-[#47645c]">
                          Bandeira: {cardBrandLabel(brand)}
                        </span>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#e6f0eb] px-2 py-0.5 text-[11px] font-semibold text-[#28634f]">
                        vence dia {card.dueDay}
                      </span>
                    </div>
                    <p className="mt-3 text-xl font-semibold tracking-tight">
                      {formatMoney(available)}
                    </p>
                    <p className="text-xs text-[#668078]">
                      disponível de {formatMoney(card.limitCents)}
                    </p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e5ebe5]">
                      <div
                        className="h-full rounded-full bg-[#24715a]"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    {brand === 'unknown' && (
                      <button
                        type="button"
                        onClick={() => void identifyCardBrand(card.id)}
                        disabled={resolvingBrandCardId === card.id}
                        className="mt-3 text-xs font-semibold text-[#174f40] underline-offset-2 hover:underline disabled:cursor-wait disabled:opacity-60"
                      >
                        {resolvingBrandCardId === card.id
                          ? 'Identificando bandeira…'
                          : 'Identificar bandeira'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startCardCorrection(card.name)}
                      className="mt-3 block text-xs font-semibold text-[#174f40] underline-offset-2 hover:underline"
                    >
                      Corrigir dados do cartão
                    </button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-[#d9e0d4] bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowUpRight size={18} /> Ritmo do mês
              </CardTitle>
              <span className="text-xs text-[#668078]">{budgetPercent}%</span>
            </CardHeader>
            <CardContent>
              <div className="h-2 overflow-hidden rounded-full bg-[#e5ebe5]">
                <div
                  className="h-full rounded-full bg-[#d38c32]"
                  style={{ width: `${budgetPercent}%` }}
                />
              </div>
              <p className="mt-3 text-sm leading-6 text-[#668078]">
                {data?.effectiveBudgetCents
                  ? `${formatMoney(data.spendingCents)} de ${formatMoney(data.effectiveBudgetCents)} do seu orçamento.`
                  : 'Configure renda ou orçamento pelo chat para acompanhar o mês.'}
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#d9e0d4] bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ReceiptText size={18} /> Compras recentes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!loading && !data?.purchases.length && (
                <p className="text-sm text-[#668078]">
                  Ainda não há compras registradas.
                </p>
              )}
              {data?.purchases.slice(0, 5).map((purchase) => (
                <div
                  key={purchase.id}
                  className="flex items-start justify-between gap-3 border-b border-[#eef1ec] pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-5">
                      {purchaseDescriptionWithoutPayment(purchase.description)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded-full bg-[#e6f0eb] px-2 py-0.5 font-semibold text-[#28634f]">
                        Pagamento: {paymentLabel(purchase.paymentMethod)}
                        {purchase.paymentMethod === 'credit' &&
                        purchase.cardName
                          ? ` · ${purchase.cardName}`
                          : ''}
                      </span>
                      <span className="rounded-full bg-[#fff3df] px-2 py-0.5 font-semibold text-[#87591d]">
                        Categoria:{' '}
                        {purchaseCategoryLabel(
                          purchase.category,
                          purchase.description,
                        )}
                      </span>
                      {purchase.merchant && (
                        <span className="text-[#668078]">
                          Local: {purchase.merchant}
                        </span>
                      )}
                      <span className="text-[#668078]">
                        {date.format(
                          new Date(`${purchase.purchasedAt}T12:00:00`),
                        )}
                      </span>
                    </div>
                  </div>
                  <strong className="shrink-0 whitespace-nowrap text-sm">
                    {formatMoney(purchase.totalCents)}
                  </strong>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-[#c9ddd3] bg-[#edf6f1] shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 size={17} /> Conectar WhatsApp
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm leading-5 text-[#47645c]">
                Informe seu número com DDI e DDD. Ex.: 5588999999999.
              </p>
              <form onSubmit={savePhone} className="space-y-2">
                <label htmlFor="whatsapp-number" className="sr-only">
                  Seu WhatsApp
                </label>
                <input
                  id="whatsapp-number"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="5588999999999"
                  inputMode="tel"
                  className="h-10 w-full rounded-xl border border-[#bcd3c6] bg-white px-3 text-sm outline-none transition focus:border-[#174f40] focus:ring-2 focus:ring-[#174f40]/15"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={savingPhone}
                  className="w-full rounded-xl border-[#174f40] text-[#174f40] hover:bg-[#174f40] hover:text-white"
                >
                  {savingPhone ? 'Salvando…' : 'Salvar meu número'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function MetricCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  tone: 'green' | 'cream' | 'light';
}) {
  const className =
    tone === 'green'
      ? 'bg-[#174f40] text-white border-[#174f40]'
      : tone === 'cream'
        ? 'bg-[#fffaf0] border-[#e8ddbc]'
        : 'bg-white border-[#d9e0d4]';
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${className}`}>
      <div
        className={`mb-4 flex w-fit rounded-xl p-2 ${tone === 'green' ? 'bg-white/15 text-white' : 'bg-[#e8f1eb] text-[#174f40]'}`}
      >
        {icon}
      </div>
      <p
        className={`text-xs ${tone === 'green' ? 'text-[#c9ddd3]' : 'text-[#668078]'}`}
      >
        {title}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div className="max-w-[88%] rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-sm leading-6 text-[#31574c] shadow-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold text-[#174f40]">
        <MessageCircleMore size={16} /> Eloá
      </div>
      Posso registrar suas compras, configurar sua renda e cartões, e analisar
      se uma compra cabe no crédito. Envie uma mensagem como:{' '}
      <span className="font-medium">“comprei almoço por R$ 28 no Pix”</span>.
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const user = message.role === 'user';
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${user ? 'rounded-br-sm bg-[#174f40] text-white' : 'rounded-bl-sm bg-white text-[#31574c]'}`}
      >
        <p>{message.content}</p>
        <p
          className={`mt-1 text-[10px] ${user ? 'text-[#c9ddd3]' : 'text-[#86a098]'}`}
        >
          {message.source === 'whatsapp' ? 'WhatsApp · ' : ''}
          {messageTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
