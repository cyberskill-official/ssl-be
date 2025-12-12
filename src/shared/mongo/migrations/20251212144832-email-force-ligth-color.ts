import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_EmailTemplate } from '#modules/email-template/email-template.type.js';

// Ensure templates render in light mode (avoid dark-mode inversion)
const META_TAGS = '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">';
const COLOR_SCHEME_CSS = 'color-scheme: light; supported-color-schemes: light;';

function ensureMeta(html: string): string {
    if (html.includes('color-scheme'))
        return html;
    return html.replace(/<head>/i, `<head>${META_TAGS}`);
}

function ensureBodyStyle(html: string): string {
    return html.replace(/<body([^>]*)style="([^"]*)"/i, (m, attrs, style) => {
        if (style.includes('color-scheme'))
            return m;
        return `<body${attrs}style="${style.trim()}${style.trim().endsWith(';') ? '' : ';'} ${COLOR_SCHEME_CSS}"`;
    });
}

function ensureTableStyle(html: string): string {
    // Add color-scheme to the first table (outer wrapper)
    return html.replace(/<table([^>]*)style="([^"]*)"/i, (m, attrs, style) => {
        if (style.includes('color-scheme'))
            return m;
        return `<table${attrs}style="${style.trim()}${style.trim().endsWith(';') ? '' : ';'} ${COLOR_SCHEME_CSS}"`;
    });
}

export async function up(db: C_Db) {
    const emailTplCtr = new MongoController<I_EmailTemplate>(db, 'emailtemplates');
    const templates = await db.collection('emailtemplates').find({}).toArray();

    if (!templates.length) {
        log.info('[email-force-light-colors] No email templates found to update.');
        return;
    }

    let updated = 0;
    for (const tpl of templates as unknown as Array<{ _id: unknown; content?: string }>) {
        if (!tpl.content || typeof tpl.content !== 'string')
            continue;

        let newContent = tpl.content;
        const before = newContent;
        newContent = ensureMeta(newContent);
        newContent = ensureBodyStyle(newContent);
        newContent = ensureTableStyle(newContent);

        if (newContent !== before) {
            await emailTplCtr.updateMany({ _id: tpl._id } as any, { content: newContent });
            updated += 1;
        }
    }

    log.success(`[email-force-light-colors] Updated ${updated} email template(s) to force light color scheme.`);
}

export async function down() {
    // no-op (cannot safely remove injected meta/styles)
    log.info('[email-force-light-colors] down(): no-op');
}
