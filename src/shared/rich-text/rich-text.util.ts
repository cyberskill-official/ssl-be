export function extractPlainTextFromRichContent(value?: string | null): string | undefined {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}'))
        return undefined;
    try {
        const json = JSON.parse(trimmed);
        const collect = (node: any): string => {
            if (!node || typeof node !== 'object')
                return '';
            let text = typeof node.text === 'string' ? node.text : '';
            if (Array.isArray(node.children)) {
                for (const child of node.children) {
                    text += collect(child);
                }
            }
            if (node.type === 'paragraph')
                return text ? `${text}\n` : '';
            return text;
        };
        const rootChildren = Array.isArray(json?.root?.children) ? json.root.children : [];
        const result = rootChildren.map(collect).join('').replace(/\n{2,}/g, '\n').trim();
        return result || undefined;
    }
    catch {
        return undefined;
    }
}
