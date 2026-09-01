import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import { FinanceDashboard } from '@/components/finance-dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  if (user) return <FinanceDashboard displayName={user.displayName} />;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f6f1] px-5 text-[#143b32]">
      <section className="w-full max-w-xl rounded-[2rem] border border-[#d9e0d4] bg-white p-7 shadow-[0_20px_70px_rgba(20,66,53,.12)] sm:p-10">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#174f40] text-xl text-white">E</div>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-[#638076]">Eloá · financeiro pessoal</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight tracking-tight">Suas compras, seu limite, suas escolhas.</h1>
        <p className="mt-4 text-base leading-7 text-[#5c756e]">Um painel particular para conversar com sua assistente financeira e, depois, continuar a mesma conversa pelo WhatsApp.</p>
        <a href={chatGPTSignInPath('/')} target="_top" className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-[#174f40] px-5 py-3.5 font-semibold text-white transition hover:bg-[#123f33]">Entrar no meu painel</a>
        <p className="mt-4 text-center text-xs leading-5 text-[#6f8780]">O acesso é protegido. Seus dados financeiros não ficam expostos em uma página pública.</p>
      </section>
    </main>
  );
}
