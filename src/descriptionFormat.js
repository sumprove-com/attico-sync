/**
 * Converts RELPER plain-text property_description into HTML for Webflow Rich Text.
 * RELPER XML export flattens line breaks; section markers split Attico boilerplate reliably.
 */

const escapeHtml = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const SECTION_SPLIT_RE =
  /(?=Cena mesečnog zakupa:|Cena:|Kontakt telefoni:|ATTICO GROUP DOO|Napomena za kolege:)/i;

const INTRO_MARKERS = [' Strukturu stana čine:', ' Terasa Stan je'];

const splitIntro = (text) => {
  if (!text) return [];
  const parts = [];
  let remaining = text;

  while (remaining) {
    let bestIdx = -1;

    for (const marker of INTRO_MARKERS) {
      const idx = remaining.indexOf(marker);
      if (idx > 0 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) {
      parts.push(remaining.trim());
      break;
    }

    parts.push(remaining.slice(0, bestIdx).trim());
    remaining = remaining.slice(bestIdx);
  }

  return parts.filter(Boolean);
};

const newlinesToHtml = (text) =>
  text
    .split(/\r?\n\s*\r?\n+/)
    .map((block) => {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return '';
      if (lines.length === 1) return `<p>${escapeHtml(lines[0])}</p>`;
      return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
    })
    .filter(Boolean)
    .join('');

const splitBySectionMarkers = (text) => {
  const segments = text.split(SECTION_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return [];

  const result = [...splitIntro(segments[0])];
  result.push(...segments.slice(1));
  return result;
};

const blocksToHtml = (blocks) =>
  blocks.map((block) => `<p>${escapeHtml(block)}</p>`).join('');

/**
 * Plain single-line text for embed spans and map popups (Webflow cannot bind Rich Text in embeds).
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export const formatDescriptionPlain = (raw) => {
  if (raw == null) return null;
  const text = String(raw).replace(/\s+/g, ' ').trim();
  return text || null;
};

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export const formatDescriptionHtml = (raw) => {
  if (raw == null) return null;

  let text = String(raw).trim();
  if (!text) return null;

  if (/\r?\n/.test(text)) {
    const html = newlinesToHtml(text);
    return html || null;
  }

  text = text.replace(/\s+/g, ' ');
  const blocks = splitBySectionMarkers(text);
  if (blocks.length === 0) return null;

  const html = blocksToHtml(blocks);
  return html || null;
};
