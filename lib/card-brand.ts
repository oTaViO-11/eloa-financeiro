import { normalizeText } from '@/lib/money';

export const cardBrands = [
  'visa',
  'mastercard',
  'elo',
  'hipercard',
  'american_express',
  'diners_club',
  'discover',
  'jcb',
  'aura',
  'cabal',
  'sorocred',
  'unknown',
] as const;

export type CardBrand = (typeof cardBrands)[number];

const labels: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  elo: 'Elo',
  hipercard: 'Hipercard',
  american_express: 'American Express',
  diners_club: 'Diners Club',
  discover: 'Discover',
  jcb: 'JCB',
  aura: 'Aura',
  cabal: 'Cabal',
  sorocred: 'Sorocred',
  unknown: 'Ainda não identificada',
};

export function normalizeCardBrand(value: unknown): CardBrand {
  if (typeof value !== 'string') return 'unknown';
  const normalized = normalizeText(value);
  if (/\b(?:visa|viza)\b/.test(normalized)) return 'visa';
  if (/\b(?:master[\s-]*card|mastercard)\b/.test(normalized))
    return 'mastercard';
  if (/\belo\b/.test(normalized)) return 'elo';
  if (/\bhipercard\b/.test(normalized)) return 'hipercard';
  if (/\b(?:american express|amex)\b/.test(normalized))
    return 'american_express';
  if (/\b(?:diners club|diners)\b/.test(normalized)) return 'diners_club';
  if (/\bdiscover\b/.test(normalized)) return 'discover';
  if (/\bjcb\b/.test(normalized)) return 'jcb';
  if (/\baura\b/.test(normalized)) return 'aura';
  if (/\bcabal\b/.test(normalized)) return 'cabal';
  if (/\bsorocred\b/.test(normalized)) return 'sorocred';
  return 'unknown';
}

export function cardBrandLabel(value: unknown): string {
  return labels[normalizeCardBrand(value)];
}
