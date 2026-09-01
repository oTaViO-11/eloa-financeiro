import type { Metadata } from 'next';
import { DM_Sans, Playfair_Display } from 'next/font/google';
import './globals.css';

const sans = DM_Sans({ variable: '--font-dm-sans', subsets: ['latin'] });
const serif = Playfair_Display({ variable: '--font-playfair', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Eloá — Assistente Financeira',
  description: 'Assistente financeira pessoal para registrar compras e analisar crédito.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${sans.variable} ${serif.variable} antialiased`}>{children}</body></html>;
}
