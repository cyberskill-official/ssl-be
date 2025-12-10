/**
 * Extract variables from email template content
 * Variables are defined using {{variableName}} syntax
 */
export function extractVariablesFromContent(content: string): string[] {
    const variableRegex = /<%[-=]\s*([\w.]+)\s*%>/g;
    const variables = new Set<string>();
    let match = variableRegex.exec(content);

    while (match !== null) {
        if (match[1]) {
            const rootVar = match[1].split('.')[0];
            if (rootVar) {
                variables.add(rootVar);
            }
        }
        match = variableRegex.exec(content);
    }

    return Array.from(variables).sort();
}
