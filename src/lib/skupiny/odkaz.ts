// Odkaz „Otevřít skupinu“: uložená URL skupiny, jinak vyhledávání skupin podle názvu.

const POVOLENE = /^https:\/\/(www\.|m\.|web\.)?facebook\.com\//i;

export function odkazSkupiny(s: { name: string; url: string | null }): string {
  const url = s.url?.trim();
  if (url && POVOLENE.test(url)) return url;
  return `https://www.facebook.com/search/groups/?q=${encodeURIComponent(s.name.trim())}`;
}
