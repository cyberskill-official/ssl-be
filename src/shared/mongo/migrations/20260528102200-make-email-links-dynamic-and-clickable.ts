import type { C_Db } from '@cyberskill/shared/node/mongo';

/**
 * @param db {C_Db}
 * @returns {Promise<void>}
 */
export async function up(db: C_Db) {
    const collection = db.collection('emailtemplates');
    const templates = await collection.find({}).toArray();

    for (const template of templates) {
        let content = (template['content'] as string) || '';
        let subject = (template['subject'] as string) || '';
        let modified = false;

        // 1. Replace hardcoded development base URL with dynamic variable
        const nextContent1 = content.replace(/https:\/\/development\.secretswingerlust\.com/g, '<%= userAppUrl %>');
        if (nextContent1 !== content) {
            content = nextContent1;
            modified = true;
        }

        const nextSubject1 = subject.replace(/https:\/\/development\.secretswingerlust\.com/g, '<%= userAppUrl %>');
        if (nextSubject1 !== subject) {
            subject = nextSubject1;
            modified = true;
        }

        // 2. Convert secretswingerlust.com text inside links to the dynamic brand name <%= brandName %>
        const nextContent2 = content.replace(/>Secretswingerlust\.com<\/a>/gi, '><%= brandName %></a>')
            .replace(/>SecretSwingerLust\.com<\/a>/gi, '><%= brandName %></a>');
        if (nextContent2 !== content) {
            content = nextContent2;
            modified = true;
        }

        // 3. Specifically replace the span in new-message template with a clickable dynamic brand link
        const targetSpan = /<span style="color:#000000;padding:2px 4px;border-radius:3px;">secretswingerlust\.com\.\.\.<\/span>/gi;
        const nextContent3 = content.replace(
            targetSpan,
            '<a href="<%= userAppUrl %>/home" target="_blank" rel="noopener noreferrer" style="color:#631B1C;text-decoration:none;font-weight:bold;"><%= brandName %></a>',
        );
        if (nextContent3 !== content) {
            content = nextContent3;
            modified = true;
        }

        if (modified) {
            const variables = Array.isArray(template['variables']) ? [...template['variables']] : [];
            if (!variables.includes('userAppUrl')) {
                variables.push('userAppUrl');
            }
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
 * @param _db {C_Db}
 * @returns {Promise<void>}
 */
export async function down(_db: C_Db) {
    // Reverting is a no-op as the dynamic variables are fully compatible
}
