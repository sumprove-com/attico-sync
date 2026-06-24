/**
 * parser.js
 * Maps raw RELPER XML fields → Webflow CMS field schema.
 */

const TIP_MAP = {
  'Stan': 'Stan',
  'Kuca': 'Kuca',
  'Kuća': 'Kuca',
  'Lokal': 'Lokal',
  'Poslovni prostor': 'Lokal',
  'Garaza': 'Garaza',
  'Garaža': 'Garaza',
  'Plac': 'Plac',
  'Građevinsko zemljište': 'Gradjevinsko zemljiste',
  'Gradjevinsko zemljiste': 'Gradjevinsko zemljiste',
  'Vikendica': 'Vikendica',
};

const DEFAULT_TIP = 'Plac';

const PURPOSE_MAP = {
  '1': 'Iznajmljivanje',
  '2': 'Prodaja',
};

const str = (val) => (val != null ? String(val).trim() : '');
const num = (val) => {
  const n = parseFloat(str(val));
  return isNaN(n) ? null : n;
};

const parseElementSet = (container, key) => {
  const els = container?.[key];
  if (!els) return new Set();
  return new Set((Array.isArray(els) ? els : [els]).map((e) => str(e).toLowerCase()));
};

const amenityText = (set, ...labels) =>
  labels.some((l) => set.has(l.toLowerCase())) ? 'Yes' : null;

/**
 * Normalize a single RELPER XML item into the Webflow CMS field shape.
 * Returns null if the item is missing required fields or is deleted.
 */
export const parseProperty = (raw) => {
  if (str(raw.deleted) === '1') return null;

  const relper_id = str(raw.property_id);
  if (!relper_id) {
    console.warn('[parser] Skipping item with no ID');
    return null;
  }

  const tip_raw = str(raw.property_type);
  const tip = TIP_MAP[tip_raw] || DEFAULT_TIP;

  const transakcija = PURPOSE_MAP[str(raw.purpose_id)] || null;

  const ulica = str(raw.property_street);
  const broj = str(raw.property_street_number);
  const hood = str(raw.property_hood);
  const hoodPart = str(raw.property_hood_part);
  const city = str(raw.property_city);
  const lokacija = [hood, hoodPart].filter(Boolean).join(', ') || hood;

  const addressForGeocode = [ulica, broj, lokacija, city, 'Serbia']
    .filter(Boolean)
    .join(', ');

  const imagesRaw = raw.images?.image;
  let slike = [];
  if (imagesRaw) {
    slike = Array.isArray(imagesRaw) ? imagesRaw : [imagesRaw];
    slike = slike.filter(Boolean).map(str);
  }

  const other = parseElementSet(raw.other, 'other_element');
  const furniture = parseElementSet(raw.furniture, 'furniture_element');
  const equipment = parseElementSet(raw.equipment, 'equipment_element');

  const floor = str(raw.property_floor);
  const floors = str(raw.property_floors);

  return {
    relper_id,
    naziv: str(raw.property_name) || `${tip}, ${lokacija}`,
    tip,
    transakcija,
    cena: num(raw.property_price),
    kvadratura: num(raw.property_surface),
    broj_soba: num(raw.structure),
    sprat: floor ? `${floor}${floors ? `/${floors}` : ''}` : null,
    lokacija,
    adresa: ulica || null,
    addressForGeocode,
    slike,
    prva_slika: slike[0] || null,
    opis_sr: str(raw.property_description) || null,
    heating: str(raw.heating?.heating_type) || null,
    beds: amenityText(furniture, 'Kreveti'),
    fridge: amenityText(furniture, 'Frižider'),
    closets: amenityText(furniture, 'Plakari/Ormani'),
    sink: amenityText(furniture, 'Sudopera'),
    kitchen_elements: amenityText(furniture, 'Kuhinjski elementi'),
    stove: amenityText(furniture, 'Šporet'),
    washing_machine: amenityText(furniture, 'Veš mašina'),
    dishwasher: amenityText(furniture, 'Mašina za sudove'),
    tv: amenityText(furniture, 'TV'),
    air_conditioning: amenityText(equipment, 'Klima'),
    parking: amenityText(other, 'Parking'),
    elevator: amenityText(other, 'Lift'),
    terrace: amenityText(other, 'Terasa'),
    video_surveillance: amenityText(other, 'Video nadzor'),
    pet_friendly: amenityText(other, 'Pet friendly', 'Ljubimci'),
    lat: num(raw.property_location_lat) ?? num(raw.location_lat),
    lng: num(raw.property_location_lng) ?? num(raw.location_lng),
  };
};

/**
 * Parse all items from the RELPER feed.
 * Filters out nulls (items that failed validation).
 */
export const parseProperties = (rawItems) => {
  const results = rawItems.map(parseProperty).filter(Boolean);
  console.log(`[parser] Parsed ${results.length}/${rawItems.length} items successfully`);
  return results;
};
