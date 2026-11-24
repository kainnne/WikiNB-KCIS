export const courseSeriesId = 'ai-intro-course';

export const seriesInstruction = 'Use each series_outline to describe the listed sections and refer to them by title. When using a source marked example:true, an example series, or a title starting with 【教學範例】, say once in the reply language that it is a fictional teaching demo, not an official school notice.';

export function articleFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return {};
  const header = markdown.match(/^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m)?.[1] || '';
  const fields = Object.create(null);
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/);
    if (!match) continue;
    try { fields[match[1]] = JSON.parse(match[2]); }
    catch { /* Values outside the supported syntax use the defaults. */ }
  }
  return fields;
}

export function seriesOutlines(hits, documents) {
  const groups = new Map();
  for (const hit of hits) {
    if (hit.seriesId && hit.seriesId !== courseSeriesId) groups.set(hit.seriesId, []);
  }
  for (const row of documents) {
    if (row.readable !== false) groups.get(row.seriesId)?.push(row);
  }
  return [...groups].filter(([, rows]) => rows.length).map(([seriesId, rows]) => {
    rows.sort((a, b) => (a.unit ?? Infinity) - (b.unit ?? Infinity) ||
      (a.filename || a.title).localeCompare(b.filename || b.title));
    return {
      scope: 'series_outline',
      series: rows.find(row => row.series)?.series || seriesId,
      seriesId,
      example: rows.some(row => row.example === true),
      units: rows.map(row => ({id: row.id, unit: row.unit ?? null, title: row.title || row.filename})),
    };
  });
}
