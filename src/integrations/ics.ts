// Fetch an .ics URL. Many school feeds don't send CORS headers, so a browser can't
// read them directly. Options: paste/upload the file, or set a CORS proxy you trust.
export async function fetchIcsText(url: string, corsProxy?: string): Promise<string> {
  const u = url.replace(/^webcal:\/\//i, 'https://');
  const attempt = async (target: string) => {
    const r = await fetch(target, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const t = await r.text();
    if (!t.includes('BEGIN:VCALENDAR')) throw new Error('Not an iCalendar feed');
    return t;
  };
  try { return await attempt(u); }
  catch (e) {
    if (!corsProxy) throw new Error(`That site blocks apps from reading the link directly. Try the calendar's "public" or "subscribe" link, or take a photo of it instead.`);
    return attempt(corsProxy.includes('{url}') ? corsProxy.replace('{url}', encodeURIComponent(u)) : corsProxy + encodeURIComponent(u));
  }
}
