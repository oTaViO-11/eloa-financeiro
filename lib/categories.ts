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
  'investimento',
  'boletos',
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
  investimento: 'Investimentos',
  boletos: 'Boletos',
  trabalho: 'Trabalho',
  presentes_doacoes: 'Presentes e doações',
  impostos_taxas: 'Impostos e taxas',
  geral: 'Geral',
};

const foodPattern = new RegExp(
  String.raw`\b(?:alimentos?|alimenticios?|comidas?|refeic(?:ao|oes)|almoc(?:o|os|ar)|jant(?:ar|ares)|cafe(?:\s+da\s+manha)?|lanche(?:s)?|marmitas?|merenda|sobremesas?|mercado|supermercado|feira|hortifruti|sacolao|mercearia|padaria|confeitaria|restaurante|pizzaria|lanchonete|hamburgueria|cafeteria|sorveteria|acougue|ifood|i\s*food|rappi|uber\s*eats|assai|atacadao|carrefour|extra|pa[oa]\s+de\s+acucar|arroz|feij(?:ao|oes)|macarr(?:ao|oes)|miojo|massa(?:s)?|lasanha|farinha|tapioca|cuscuz|aveia|granola|cereal|carne(?:s)?|bife(?:s)?|file(?:s)?|picanha|frango(?:s)?|peixe(?:s)?|camarao|linguica|salsicha|bacon|ovo(?:s)?|pa(?:o|es)|bolo(?:s)?|biscoit(?:o|os)|bolacha(?:s)?|salgad(?:o|os)|pastel(?:is)?|coxinha(?:s)?|pizza(?:s)?|hamburguer(?:es)?|amburguer(?:es)?|sanduiche(?:s)?|hot\s*dog|cachorro\s*quente|acai|sushi|temaki|leite|queijo(?:s)?|parmesao|iogurte(?:s)?|manteiga|requeijao|creme\s+de\s+leite|fruta(?:s)?|banana(?:s)?|maca(?:s)?|laranja(?:s)?|uva(?:s)?|morango(?:s)?|manga(?:s)?|mamao|abacaxi|melancia|melao|limao|pera(?:s)?|abacate|goiaba|tangerina|mexerica|kiwi|ameixa|maracuja|coco|tomate(?:s)?|batata(?:s)?|cebola(?:s)?|alho|cenoura(?:s)?|abobora|mandioca|macaxeira|aipim|inhame|beterraba|alface|couve|repolho|espinafre|pepino|pimentao|verdura(?:s)?|legume(?:s)?|salada(?:s)?|brocolis|milho|chocolate(?:s)?|doce(?:s)?|bala(?:s)?|sorvete(?:s)?|pipoca|mussarela|mozarela|suco(?:s)?|refrigerante(?:s)?|coca\s*cola|pepsi|guarana|cerveja(?:s)?|vinho(?:s)?|cha(?:s)?|energetic(?:o|os)|milk\s*shake|mil+k?shake|milcheik|agua\s+(?:mineral|com\s+gas)|bebida(?:s)?|drink(?:s)?)\b`,
  'u',
);

const categoryRules: Array<[SpendingCategory, RegExp]> = [
  ['saude', /\b(?:upa|consulta|medicamentos?|remedios?|remedio|hospital|clinica|exame|farmacia|farmcia|drogaria|vacina|dentista|terapia|psicolog[oa]|plano de saude|laboratorio|cirurgia|oculos|optica)\b/],
  ['investimento', /\b(?:investimento(?:s)?|investi|investir|apliquei|aplicar|aplicacao|aportei|aporte|cdb|lci|lca|tesouro(?:\s+direto)?|renda\s+fixa|bolsa\s+de\s+valores|acoes?|fii(?:s)?|etf(?:s)?|fundo\s+de\s+investimento|previdencia(?:\s+privada)?|cripto(?:moeda)?s?|bitcoin|btc|ethereum|eth|corretora|poupanca)\b/],
  ['assinaturas', /\b(?:assinatura|streaming|renovacao|recorrente|netflix|spotify|deezer|prime\s+video|amazon\s+prime|disney\+?|hbo|max|youtube\s+premium|icloud|google\s+one|apple\s+music|crunchyroll|globoplay|paramount\+?|adobe|canva|microsoft\s*(?:365|office)|playstation\s*(?:plus|ps)|ps\s*plus|xbox\s+(?:game\s+pass|live)|nintendo\s+switch\s+online|chatgpt\s*(?:plus|pro)|notion|dropbox)\b/],
  ['boletos', /\b(?:boleto|boletos)\b/],
  ['contas_servicos', /\b(?:conta\s+(?:de\s+)?agua|agua\s+(?:encanada|da\s+companhia))\b/],
  ['casa', /\b(?:agua\s+sanitaria|desinfetante|detergente|sabao)\b/],
  ['pets', /\b(?:pet|racao|veterinario|veterinaria|animais?|cachorro|gato)\b/],
  ['alimentacao', foodPattern],
  ['casa', /\b(?:movel|moveis|mobilia|sofa|cama|mesa|cadeira|armario|estante|colchao|tapete|cortina|decoracao|utensilios?|panela|prato|talher|geladeira|fogao|forno|microondas|maquina de lavar|lavadora|secadora|aspirador|ventilador|ar condicionado|eletrodomesticos?)\b/],
  ['roupas', /\b(?:roupa|camisa|camiseta|blusa|calca|bermuda|short|vestido|sapato|tenis|chinelo|sandalia|bolsa|mochila|moda)\b/],
  ['transporte', /\b(?:uber|99|taxi|gasolina|combustivel|onibus|passagem|estacionamento|metro|transporte|lavagem do carro|oficina|mecanico|pedagio)\b/],
  ['contas_servicos', /\b(?:energia|luz|agua|gas|telefone|celular|internet|wifi|recarga|condominio|manutencao|conserto|reparo|encanador|eletricista)\b/],
  ['moradia', /\b(?:aluguel|moradia|imovel|imobiliaria|financiamento da casa)\b/],
  ['tecnologia', /\b(?:celular|smartphone|notebook|computador|tablet|fone|headset|teclado|mouse|monitor|impressora|software|aplicativo|app|jogo digital)\b/],
  ['educacao', /\b(?:curso|escola|faculdade|universidade|livro|material escolar|aula|mensalidade|apostila|idioma)\b/],
  ['lazer', /\b(?:cinema|show|viagem|jogo|teatro|bar|balada|passeio|parque|evento)\b/],
  ['cuidados_pessoais', /\b(?:salao|barbearia|maquiagem|perfume|cosmetico|manicure|shampoo|beleza|skin care|skincare)\b/],
  ['trabalho', /\b(?:trabalho|coworking|ferramenta|equipamento profissional|material de trabalho|uniforme)\b/],
  ['presentes_doacoes', /\b(?:presente|doacao|doar|contribuicao|vaquinha|caridade)\b/],
  ['impostos_taxas', /\b(?:imposto|iptu|ipva|taxa|multa|darf|licenciamento)\b/],
];

export function classifyPurchaseCategory(value: string): SpendingCategory {
  const normalized = normalizeText(value)
    .replace(/\bmercado\s+(?:pago|livre)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (/\b(?:investimentos?|investir|aplicar|aporte|cdb|lci|lca|tesouro|renda fixa|acoes?|fii|etf|cripto|bitcoin|previdencia)\b/.test(normalized)) return 'investimento';
  if (/\b(?:boleto|boletos)\b/.test(normalized)) return 'boletos';
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
