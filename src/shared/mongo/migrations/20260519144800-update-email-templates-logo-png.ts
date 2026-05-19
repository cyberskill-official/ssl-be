import type { C_Db } from '@cyberskill/shared/node/mongo';
import { log } from '@cyberskill/shared/node/log';
import { getEnv } from '#shared/env/index.js';

/**
 * Migration: Update email templates
 * 1. Change logo to logo.png instead of WebP (Fixes black background issue on Gmail).
 * 2. Follow Trademark Guidelines (Secret® only on the first prominent mention).
 */

export async function up(db: C_Db) {
    const env = getEnv();
    const LOGO_URL = env.EMAIL_LOGO_URL?.trim()
        || 'https://ssl-development.b-cdn.net/LOGO/logo.png';

    const collection = db.collection('emailtemplates');
    const templates = await collection.find({}).toArray();
    let updatedCount = 0;

    for (const template of templates) {
        if (!template['content']) continue;

        let newContent = String(template['content']);
        let modified = false;

        // 1. Replace the old .webp URL with the new .png URL
        const oldLogoUrls = [
            'https://ssl-development.b-cdn.net/LOGO/SecretswingerlustlogoRwhite.png',
            'https://ssl-development.b-cdn.net/LOGO/SecretswingerlustlogoRwhite.webp',
            'https://development.secretswingerlust.com/images/Logo_secretswingerlust_white.png'
        ];

        for (const oldUrl of oldLogoUrls) {
            if (newContent.includes(oldUrl)) {
                newContent = newContent.replace(new URL(oldUrl).href, LOGO_URL);
                modified = true;
            } else if (newContent.includes(oldUrl.replace(/&amp;/g, '&'))) {
                newContent = newContent.replaceAll(oldUrl.replace(/&amp;/g, '&'), LOGO_URL);
                modified = true;
            }
        }

        // 2. Trademark Rules Replacements
        const trademarkReplacements = [
            { from: 'alt="Secret® Swinger Lust Logo"', to: 'alt="Secret Swinger Lust Logo"' },
            { from: 'enabled on your Secret® Swinger Lust profile', to: 'enabled on your Secret Swinger Lust profile' },
            { from: '>Secret® Swinger Lust</a>\n                </li>\n                <li style="margin-bottom:8px;font-weight:normal;">Click My Profile', to: '>Secret Swinger Lust</a>\n                </li>\n                <li style="margin-bottom:8px;font-weight:normal;">Click My Profile' },
            { from: 'Yours playfully,<br/>\n                                Secret® Swinger Lust Team', to: 'Yours playfully,<br/>\n                                Secret Swinger Lust Team' },
            { from: 'Secret® Swinger Lust by JOLO Media ApS, Denmark. Secret® is a registered EU trademark.', to: 'Secret Swinger Lust by JOLO Media ApS, Denmark. Secret® is a registered EU trademark.' },
            { from: 'Welcome to <a href="https://development.secretswingerlust.com/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">Secret® Swinger Lust</a>', to: 'Welcome to <a href="https://development.secretswingerlust.com/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">Secret Swinger Lust</a>' },
            { from: 'receipt will say Jolo Media, not Secret® Swinger Lust', to: 'receipt will say Jolo Media, not Secret Swinger Lust' },
            { from: 'At Secret® Swinger Lust, you\'re not just a profile', to: 'At Secret Swinger Lust, you\'re not just a profile' }
        ];

        for (const { from, to } of trademarkReplacements) {
            if (newContent.includes(from)) {
                newContent = newContent.replaceAll(from, to);
                modified = true;
            }
        }

        // Regex for dynamic BASE_URL links
        const linkRegex = /Welcome to <a href="([^"]+)" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">Secret® Swinger Lust<\/a> – your new favourite place/g;
        if (linkRegex.test(newContent)) {
            newContent = newContent.replace(linkRegex, 'Welcome to <a href="$1" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;">Secret Swinger Lust</a> – your new favourite place');
            modified = true;
        }

        if (modified) {
            await collection.updateOne(
                { _id: template._id },
                { $set: { content: newContent } }
            );
            updatedCount++;
            log.info(`[template-update] Updated template: ${template['templateKey']}`);
        }
    }

    log.success(`[template-update] Successfully updated ${updatedCount} email template(s).`);
}

export async function down(_db: C_Db) {
    log.info('[template-update] Down migration is a no-op.');
}
