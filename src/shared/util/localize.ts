function isPlainObject(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && value.constructor === Object;
}

const SUPPORTED_LOCALES = new Set(['en', 'da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi', 'vi']);

export function isLocalizedStringObject(val: any): boolean {
    if (!isPlainObject(val))
        return false;
    const keys = Object.keys(val);
    if (keys.length === 0)
        return false;
    // Every key in the object must be a supported locale
    return keys.every(key => SUPPORTED_LOCALES.has(key));
}

export function localizeValue(val: any, locale: string): any {
    if (isLocalizedStringObject(val)) {
        const resolved = val[locale] !== undefined ? val[locale] : val['en'];
        return resolved;
    }

    if (Array.isArray(val)) {
        return val.map(item => localizeValue(item, locale));
    }

    if (isPlainObject(val)) {
        const localizedObj: Record<string, any> = {};
        for (const [key, value] of Object.entries(val)) {
            localizedObj[key] = localizeValue(value, locale);
        }
        return localizedObj;
    }

    return val;
}

export function localizeDocument<T>(doc: T, locale: string): T {
    if (!doc)
        return doc;

    // Check if it's a Mongoose document
    let plainDoc: any = doc;
    if (typeof (doc as any).toObject === 'function') {
        plainDoc = (doc as any).toObject({ virtuals: true });
    }
    else if (typeof (doc as any).toJSON === 'function') {
        plainDoc = (doc as any).toJSON();
    }

    return localizeValue(plainDoc, locale);
}
