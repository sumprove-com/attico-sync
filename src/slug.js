const TRANSLITERATE = {
  č: 'c', ć: 'c', đ: 'd', š: 's', ž: 'z',
  Č: 'c', Ć: 'c', Đ: 'd', Š: 's', Ž: 'z',
};

const MAX_NAME_SLUG_LENGTH = 80;

export const slugify = (text) => {
  if (!text) return '';

  let normalized = String(text);
  for (const [from, to] of Object.entries(TRANSLITERATE)) {
    normalized = normalized.replaceAll(from, to);
  }

  return normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_NAME_SLUG_LENGTH)
    .replace(/-+$/g, '');
};

export const buildItemSlug = (prop) => {
  const id = String(prop.relper_id);
  const nameSlug = slugify(prop.naziv);
  return nameSlug ? `${nameSlug}-${id}` : id;
};
