export const SIZE_ORDER = ['P', 'M', 'G', 'GG', 'XG'];

export function sortSizes(sizes) {
  return [...(sizes || [])].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.size);
    const ib = SIZE_ORDER.indexOf(b.size);
    if (ia === -1 && ib === -1) return String(a.size).localeCompare(String(b.size), 'pt-BR');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
