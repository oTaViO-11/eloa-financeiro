import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import { FinanceDashboard } from '@/components/finance-dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  if (user) return <FinanceDashboard displayName={user.displayName} />;

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,_#fffdf8_0,_#faf5eb_52%,_#edf3e9_100%)] px-5 text-[#093e29]">
      <section className="w-full max-w-xl rounded-[2rem] border border-[#cadac8] bg-[#fffdf8] p-7 shadow-[0_20px_70px_rgba(9,62,41,.13)] sm:p-10">
        <img
          src="/eloa-logo-principal.png"
          alt="Eloá - Sua Assistente Financeira"
          className="h-40 w-36 rounded-2xl object-contain shadow-[0_14px_32px_rgba(9,62,41,.16)]"
        />
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-[#61766a]">Eloá · financeiro pessoal</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight tracking-tight">Suas compras, seu limite, suas escolhas.</h1>
        <p className="mt-4 text-base leading-7 text-[#61766a]">Um painel particular para conversar com sua assistente financeira e, depois, continuar a mesma conversa pelo WhatsApp.</p>
        <a href={chatGPTSignInPath('/')} target="_top" className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-[#093e29] px-5 py-3.5 font-semibold text-white transition hover:bg-[#063421]">Entrar no meu painel</a>
        <p className="mt-4 text-center text-xs leading-5 text-[#738278]">O acesso é protegido. Seus dados financeiros não ficam expostos em uma página pública.</p>
      </section>
    </main>
  );
}
