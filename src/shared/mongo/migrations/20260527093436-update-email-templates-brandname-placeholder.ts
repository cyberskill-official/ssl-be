import type { C_Db } from '@cyberskill/shared/node/mongo';

/**
 * @param db {C_Db}
 * @returns {Promise<void>}
 */
export async function up(db: C_Db) {
    const collection = db.collection('emailtemplates');
    const templates = await collection.find({}).toArray();

    const replacements = [
        { search: /alt="Secret SwingerLust Logo"/g, replace: 'alt="<%= brandName %> Logo"' },
        { search: /alt="Secret Swinger Lust Logo"/g, replace: 'alt="<%= brandName %> Logo"' },
        { search: /Secretswingerlust Team/g, replace: '<%= brandName %> Team' },
        { search: /Secret Swinger Lust Team/g, replace: '<%= brandName %> Team' },
        { search: /Secretswingerlust profile/g, replace: '<%= brandName %> profile' },
        { search: /Secret Swinger Lust profile/g, replace: '<%= brandName %> profile' },
        { search: /At Secretswingerlust/g, replace: 'At <%= brandName %>' },
        { search: /Welcome to Secretswingerlust/g, replace: 'Welcome to <%= brandName %>' },
        { search: /SecretSwingerLust community/g, replace: '<%= brandName %> community' },
        { search: /Secret Swinger Lust community/g, replace: '<%= brandName %> community' },
        { search: /\[Secret Swinger Lust\]/g, replace: '[<%= brandName %>]' },
        { search: /\[Secret® Swinger Lust\]/g, replace: '[<%= brandName %>]' },
    ];

    for (const template of templates) {
        let content = (template['content'] as string) || '';
        let subject = (template['subject'] as string) || '';
        let modified = false;

        for (const { search, replace } of replacements) {
            const nextContent = content.replace(search, replace);
            if (nextContent !== content) {
                content = nextContent;
                modified = true;
            }

            const nextSubject = subject.replace(search, replace);
            if (nextSubject !== subject) {
                subject = nextSubject;
                modified = true;
            }
        }

        if (modified) {
            const variables = Array.isArray(template['variables']) ? [...template['variables']] : [];
            if (!variables.includes('brandName')) {
                variables.push('brandName');
            }

            await collection.updateOne(
                { _id: template['_id'] },
                {
                    $set: {
                        content,
                        subject,
                        variables,
                        updatedAt: new Date(),
                    },
                },
            );
        }
    }
}

/**
 * @param db {C_Db}
 * @returns {Promise<void>}
 */
export async function down(_db: C_Db) {
    // Reverting is a no-op as the EJS placeholder remains fully backward-compatible
}
