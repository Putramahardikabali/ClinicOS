import COUNTRIES from "@/data/nationalities.json";

export const NATIONALITIES = COUNTRIES;

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const byNameLower = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));

export function findNationalityByCode(code) {
  if (!code) return null;
  return byCode.get(String(code).trim().toUpperCase()) || null;
}

export function findNationalityByName(name) {
  if (!name) return null;
  return byNameLower.get(String(name).trim().toLowerCase()) || null;
}

export function resolvePatientNationality(patient = {}) {
  if (patient.nationality_code) {
    const byCodeMatch = findNationalityByCode(patient.nationality_code);
    if (byCodeMatch) return byCodeMatch;
  }
  if (patient.nationality) {
    const byNameMatch = findNationalityByName(patient.nationality);
    if (byNameMatch) return byNameMatch;
  }
  return null;
}

export function nationalitySearchText(country) {
  return `${country.name} ${country.code}`.toLowerCase();
}
