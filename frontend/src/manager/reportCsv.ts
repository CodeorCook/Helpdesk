export function escapeCsvCell(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  const dangerous = typeof value === 'string' &&
    /^[\s\u0000-\u001f]*(?:[=+\-@＝＋－＠]|[\t\r\n])/.test(text);
  return `"${(dangerous ? "'" + text : text).replace(/"/g, '""')}"`;
}
