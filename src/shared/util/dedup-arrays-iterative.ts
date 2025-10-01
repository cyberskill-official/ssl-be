export function dedupArraysIterative(root: any) {
    const uniq = <T>(a: T[]) => Array.from(new Set(a));
    const isPrim = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v);

    if (!root || typeof root !== 'object')
        return;
    const stack: any[] = [root];

    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || Array.isArray(node))
            continue;

        for (const k of Object.keys(node)) {
            const v = node[k];

            if (Array.isArray(v)) {
                const isIds = k.toLowerCase().endsWith('ids');

                if (v.every(isPrim) && isIds) {
                    node[k] = uniq(v);
                }
                else if (
                    v.length > 0
                    && v.every(o => o && typeof o === 'object' && typeof o.id === 'string')
                ) {
                    const seen = new Set<string>();
                    node[k] = v.filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true)));
                }

                for (const item of v) {
                    if (item && typeof item === 'object')
                        stack.push(item);
                }
            }
            else if (v && typeof v === 'object') {
                stack.push(v);
            }
        }
    }
}
