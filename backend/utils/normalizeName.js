module.exports = function normalizeName(name) {
  if (!name) return '';

  return name
    .toLowerCase()
    .replace(/,/g, '')        // remove commas (Last, First)
    .replace(/\./g, '')       // remove periods
    .replace(/jr|sr|ii|iii/g, '') // remove suffixes
    .replace(/[^a-z\s]/g, '') // remove all non letters
    .replace(/\s+/g, ' ')     // collapse spaces
    .trim();
};

