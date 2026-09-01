export const MAX_MONEY_CENTS = 10_000_000_000;

export function formatBrl(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(cents));
  const whole = Math.floor(absolute / 100).toLocaleString('pt-BR');
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}R$ ${whole},${fraction}`;
}

export function parseCents(value: string, allowZero = false): number {
  const compact = value
    .replace(/^\s*r\s*(?:\$|s)\s*/i, '')
    .replace(/\s*(?:reais?|rs)\s*$/i, '')
    .replace(/\s/g, '')
    .trim();
  if (!compact) throw new Error('Informe um valor valido.');

  let normalized = compact;
  if (compact.includes(',')) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, '');
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Informe um valor valido.');
  }
  const [whole, decimals = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) {
    throw new Error('O valor excede o limite deste aplicativo.');
  }
  if (cents < 0 || (!allowZero && cents === 0)) {
    throw new Error('O valor precisa ser positivo.');
  }
  return cents;
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) {
    throw new Error('Informe o WhatsApp com DDI e DDD.');
  }
  return digits;
}
