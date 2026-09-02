import { normalizeText } from '@/lib/money';

export const spendingCategories = [
  'alimentacao',
  'saude',
  'casa',
  'roupas',
  'transporte',
  'moradia',
  'contas_servicos',
  'educacao',
  'lazer',
  'cuidados_pessoais',
  'pets',
  'tecnologia',
  'assinaturas',
  'trabalho',
  'presentes_doacoes',
  'impostos_taxas',
  'geral',
] as const;

export type SpendingCategory = (typeof spendingCategories)[number];

const labels: Record<SpendingCategory, string> = {
  alimentacao: 'Alimentação',
  saude: 'Saúde',
  casa: 'Casa',
  roupas: 'Roupas',
  transporte: 'Transporte',
  moradia: 'Moradia',
  contas_servicos: 'Contas e serviços',
  educacao: 'Educação',
  lazer: 'Lazer',
  cuidados_pessoais: 'Cuidados pessoais',
  pets: 'Pets',
  tecnologia: 'Tecnologia',
  assinaturas: 'Assinaturas',
  trabalho: 'Trabalho',
  presentes_doacoes: 'Presentes e doações',
  impostos_taxas: 'Impostos e taxas',
  geral: 'Geral',
};

const categoryRules: Array<[SpendingCategory, RegExp]> = [
  ['saude', /\b(?:upa|consulta|medicamentos?|remedios?|remedio|hospital|clinica|exame|farmacia|farmcia|drogaria|vacina|dentista|terapia|psicolog[oa]|plano de saude|laboratorio|cirurgia|oculos|optica)\b/],
  ['alimentacao', /\b(?:mercado|mercdo|supermercado|feira|padaria|restaurante|lanches?|milk\s*shake|mil+k?shake|milcheik|cafe|comidas?|almocos?|jantares?|bebidas?|aguas?|sucos?|refrigerantes?|cervejas?|vinhos?|bananas?|frutas?|arroz|feijao|carnes?|leite|pizzas?|hamburgueres?|acai|sushi|doces?|sorvetes?|ifood|delivery|lanchonete)\b/],
  ['casa', /\b(?:movel|moveis|mobilia|sofa|cama|mesa|cadeira|armario|estante|colchao|tapete|cortina|decoracao|utensilios?|panela|prato|talher|geladeira|fogao|forno|microondas|maquina de lavar|lavadora|secadora|aspirador|ventilador|ar condicionado|eletrodomesticos?)\b/],
  ['roupas', /\b(?:roupa|camisa|camiseta|blusa|calca|bermuda|short|vestido|sapato|tenis|chinelo|sandalia|bolsa|mochila|moda)\b/],
  ['transporte', /\b(?:uber|99|taxi|gasolina|combustivel|onibus|passagem|estacionamento|metro|transporte|lavagem do carro|oficina|mecanico|pedagio)\b/],
  ['contas_servicos', /\b(?:energia|luz|agua|gas|telefone|celular|internet|wifi|recarga|condominio|manutencao|conserto|reparo|encanador|eletricista)\b/],
  ['moradia', /\b(?:aluguel|moradia|imovel|imobiliaria|financiamento da casa)\b/],
  ['tecnologia', /\b(?:celular|smartphone|notebook|computador|tablet|fone|headset|teclado|mouse|monitor|impressora|software|aplicativo|app|jogo digital)\b/],
  ['educacao', /\b(?:curso|escola|faculdade|universidade|livro|material escolar|aula|mensalidade|apostila|idioma)\b/],
  ['assinaturas', /\b(?:assinatura|streaming|netflix|spotify|prime video|disney|hbo|youtube premium|icloud|google one)\b/],
  ['lazer', /\b(?:cinema|show|viagem|jogo|teatro|bar|balada|passeio|parque|evento)\b/],
  ['cuidados_pessoais', /\b(?:salao|barbearia|maquiagem|perfume|cosmetico|manicure|shampoo|beleza|skin care|skincare)\b/],
  ['pets', /\b(?:pet|racao|veterinario|veterinaria|animais?|cachorro|gato)\b/],
  ['trabalho', /\b(?:trabalho|coworking|ferramenta|equipamento profissional|material de trabalho|uniforme)\b/],
  ['presentes_doacoes', /\b(?:presente|doacao|doar|contribuicao|vaquinha|caridade)\b/],
  ['impostos_taxas', /\b(?:imposto|iptu|ipva|taxa|multa|darf|licenciamento)\b/],
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
  if (/\b(?:casa|movel|eletrodomestico|decoracao)\b/.test(normalized)) return 'casa';
  if (/\b(?:roupa|vestuario|clothing|moda)\b/.test(normalized)) return 'roupas';
  if (/\b(?:transporte|transport|uber|gasolina)\b/.test(normalized)) return 'transporte';
  if (/\b(?:moradia|aluguel|housing)\b/.test(normalized)) return 'moradia';
  if (/\b(?:contas?|servicos?|energia|agua|internet)\b/.test(normalized)) return 'contas_servicos';
  if (/\b(?:educacao|education|curso|escola)\b/.test(normalized)) return 'educacao';
  if (/\b(?:lazer|entertainment|diversao)\b/.test(normalized)) return 'lazer';
  if (/\b(?:cuidados[ -]pessoais|beleza|personal care)\b/.test(normalized)) return 'cuidados_pessoais';
  if (/\b(?:pet|animais)\b/.test(normalized)) return 'pets';
  if (/\b(?:tecnologia|technology|notebook|celular)\b/.test(normalized)) return 'tecnologia';
  if (/\b(?:assinatura|subscription|streaming)\b/.test(normalized)) return 'assinaturas';
  if (/\b(?:trabalho|work|ferramenta)\b/.test(normalized)) return 'trabalho';
  if (/\b(?:presente|doacao|donation)\b/.test(normalized)) return 'presentes_doacoes';
  if (/\b(?:imposto|taxa|tax)\b/.test(normalized)) return 'impostos_taxas';
  return 'geral';
}

export function purchaseCategoryLabel(value: unknown, description = ''): string {
  const normalized = normalizePurchaseCategory(value);
  const category = normalized === 'geral' || !normalized
    ? classifyPurchaseCategory(description)
    : normalized;
  return labels[category];
}
