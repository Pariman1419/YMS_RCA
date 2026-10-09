export const knowledgeCatalog = [
  {
    id: 'ti-fa',
    title: 'Texas Instruments - Failure analysis',
    url: 'https://www.ti.com/quality-reliability/faqs/failure-analysis.html',
    publisher: 'Texas Instruments',
    topics: ['analysis', 'defect', 'reject', 'mold', 'inspection'],
  },
  {
    id: 'amkor-interconnect',
    title: 'Amkor - Wirebond interconnect technology',
    url: 'https://amkor.com/technology/interconnect/',
    publisher: 'Amkor Technology',
    topics: ['wire', 'bond', 'loop', 'pad', 'copper', 'silver'],
  },
  {
    id: 'ti-assembly',
    title: 'Texas Instruments - Assembly and test',
    url: 'https://www.ti.com/about-ti/worldwide-manufacturing/assembly-test.html',
    publisher: 'Texas Instruments',
    topics: ['assembly', 'die', 'saw', 'material', 'package', 'packing'],
  },
];
export function selectKnowledgeSources(topic: string) {
  const text = topic.toLowerCase();
  const specific = knowledgeCatalog
    .slice(1)
    .map((s) => ({ s, score: s.topics.filter((t) => text.includes(t)).length }))
    .sort((a, b) => b.score - a.score)[0].s;
  return [knowledgeCatalog[0], specific];
}
export function knowledgeText(html: string) {
  const main =
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    html;
  return main
    .replace(/<(script|style|nav|header|footer|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
const cache = new Map<string, { expires: number; value: any }>();
// Only fixed public publisher URLs are fetched. No lot IDs, prompts or factory data leave YMS.
export async function externalKnowledge(enabled: boolean, topic: string, fetcher: typeof fetch = fetch) {
  if (!enabled) return { enabled: false, status: 'disabled', sources: [], limitations: [] };
  const results = await Promise.all(
    selectKnowledgeSources(topic).map(async (source) => {
      const cached = fetcher === fetch ? cache.get(source.id) : undefined;
      if (cached && cached.expires > Date.now()) return cached.value;
      try {
        const response = await fetcher(source.url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
          headers: { Accept: 'text/html', 'User-Agent': 'YMS-Knowledge/1.0' },
        });
        if (!response.ok || !/text\/(html|plain)/i.test(response.headers.get('content-type') || ''))
          throw new Error('Unavailable');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Empty response');
        let text = '',
          bytes = 0;
        const decoder = new TextDecoder();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 1024 * 1024) throw new Error('Oversized response');
            text += decoder.decode(chunk.value, { stream: true });
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const content = knowledgeText(text);
        const anchor =
          source.id === 'amkor-interconnect'
            ? /Improved cost management|Silver Alloy Wirebond/i
            : source.id === 'ti-fa'
              ? /Failure analysis process|Non.destructive testing/i
              : /At the A\/T site|Assembly.*test/i;
        const start = Math.max(0, content.search(anchor));
        const excerpt = content.slice(start, start + 1000);
        if (excerpt.length < 100) throw new Error('No readable content');
        const value = {
          id: source.id,
          title: source.title,
          url: source.url,
          publisher: source.publisher,
          retrievedAt: new Date().toISOString(),
          excerpt,
        };
        if (fetcher === fetch) cache.set(source.id, { expires: Date.now() + 3600000, value });
        return value;
      } catch {
        return null;
      }
    }),
  );
  const sources = results.filter(Boolean);
  return {
    enabled: true,
    status: sources.length === results.length ? 'available' : sources.length ? 'partial' : 'unavailable',
    sources,
    limitations:
      sources.length < results.length
        ? [
            'One or more public references could not be retrieved. Analysis continues with available warehouse evidence.',
          ]
        : [],
  };
}
