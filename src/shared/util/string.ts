export function toCapitalized(w: string): string {
    if (!w)
        return '';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}
