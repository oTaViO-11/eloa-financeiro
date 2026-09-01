import { normalizeText } from '@/lib/money';

export const spendingCategories = [
  'alimentacao',
  'saude',
  'roupas',
  'transporte',
  'moradia',
  'educacao',
  'lazer',
  'cuidados_pessoais',
  'pets',
  'geral',
] as const;

export type SpendingCategory = (typeof spendingCategories)[number];

const labels: Record<SpendingCategory, string> = {
  alimentacao: 'Alimentação',
  saude: 'Saúde',
  roupas: 'Roupas',
  transporte: 'Transporte',
  moradia: 'Moradia',
  educacao: 'Educação',
  lazer: 'Lazer',
  cuidados_pessoais: 'Cuidados pessoais',
  pets: 'Pets',
  geral: 'Geral',
};

const categoryRules: Array<[SpendingCategory, RegExp]> = [
  ['saude', /\b(?:upa|consulta|medic[oa]mentos?|hospital|clinica|exame|farmacia|farmcia|remedios?|vacina|dentista|terapia|psicolog[oa]|plano de saude)\b/],
  ['alimentacao', /\b(?:mercado|mercdo|supermercado|feira|padaria|restaurante|lanche|milk\s*shake|mil+k?shake|milcheik|cafe|comida|almoco|jantar|bebida|banana|pizza|hamburguer|acai|sushi|ifood|delivery)\b/],
  ['roupas', /\b(?:roupa|camisa|camiseta|blusa|calca|bermuda|short|vestido|sapato|tenis|chinelo|sandalia|moda)\b/],
  ['transporte', /\b(?:uber|99|taxi|gasolina|combustivel|onibus|passagem|estacionamento|metro|transporte)\b/],
  ['moradia', /\b(?:aluguel|condominio|energia|luz|agua|gas|internet|casa|manutencao|iptu)\b/],
  ['educacao', /\b(?:curso|escola|faculdade|universidade|livro|material escolar|aula|mensalidade)\b/],
  ['lazer', /\b(?:cinema|show|viagem|jogo|streaming|netflix|spotify|teatro|bar|balada)\b/],
  ['cuidados_pessoais', /\b(?:salao|barbearia|maquiagem|perfume|cosmetico|manicure|shampoo|beleza)\b/],
  ['pets', /\b(?:pet|racao|veterinario|veterinaria|animais?)\b/],
];

export function classifyPurchaseCategory(value: string): SpendingCategory {
  const normalized = normalizeText(value);
  return categoryRules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? 'geral';
}

export function normalizePurchaseCategory(value: unknown): SpendingCategory | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = normalizeText(value);
  const canonical = normalized.replace(/\s+/g, '_') as SpendingCategory;
  if (spendingCategories.includes(canonical)) return canonical;
  if (/\b(?:alimentacao|alimento|comida|food)\b/.test(normalized)) return 'alimentacao';
  if (/\b(?:saude|health|medic|hospital|farmacia)\b/.test(normalized)) return 'saude';
  if (/\b(?:roupa|vestuario|clothing|moda)\b/.test(normalized)) return 'roupas';
  if (/\b(?:transporte|transport|uber|gasolina)\b/.test(normalized)) return 'transporte';
  if (/\b(?:moradia|casa|housing)\b/.test(normalized)) return 'moradia';
  if (/\b(?:educacao|education|curso|escola)\b/.test(normalized)) return 'educacao';
  if (/\b(?:lazer|entertainment|diversao)\b/.test(normalized)) return 'lazer';
  if (/\b(?:cuidados[ -]pessoais|beleza|personal care)\b/.test(normalized)) return 'cuidados_pessoais';
  if (/\b(?:pet|animais)\b/.test(normalized)) return 'pets';
  return 'geral';
}

export function purchaseCategoryLabel(value: unknown, description = ''): string {
  const normalized = normalizePurchaseCategory(value);
  const category = normalized === 'geral' || !normalized
    ? classifyPurchaseCategory(description)
    : normalized;
  return labels[category];
}
