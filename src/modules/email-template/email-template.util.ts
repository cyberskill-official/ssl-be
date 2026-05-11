/**
 * Extract variables from email template content
 * Variables are defined using {{variableName}} syntax
 */
const EJS_VARIABLE_REGEX = /<%[-=]\s*([\w.]+)\s*%>/g;

export function extractVariablesFromContent(content: string): string[] {
    const variableRegex = new RegExp(EJS_VARIABLE_REGEX.source, EJS_VARIABLE_REGEX.flags);
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

    return [...variables].sort();
}
