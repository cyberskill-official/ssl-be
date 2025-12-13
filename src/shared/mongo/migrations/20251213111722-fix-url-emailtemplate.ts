import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { fileURLToPath } from 'node:url';

fileURLToPath(import.meta.url); // keep for consistency with other migrations

const OLD_URL = 'https://development.secretswingerlust.com/home';
const NEW_URL = 'https://secretswingerlust.com/home';

export async function up(db: C_Db) {
    const collection = db.collection('emailtemplates');

    log.info(`[Migration] Starting URL replacement in email templates: ${OLD_URL} -> ${NEW_URL}`);

    // Find all email templates that contain the old URL
    const templates = await collection.find({
        $or: [
            { content: { $regex: OLD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
            { subject: { $regex: OLD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        ],
    }).toArray();

    if (templates.length === 0) {
        log.info('[Migration] No email templates found with the old URL. Nothing to update.');
        return;
    }

    log.info(`[Migration] Found ${templates.length} email template(s) to update.`);

    let updatedCount = 0;

    for (const template of templates) {
        let hasChanges = false;
        const update: { content?: string; subject?: string } = {};

        // Replace in content field - exact match only
        if (template['content'] && typeof template['content'] === 'string') {
            if (template['content'].includes(OLD_URL)) {
                // Use global replace to replace all occurrences
                const newContent = template['content'].replace(new RegExp(OLD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), NEW_URL);
                if (newContent !== template['content']) {
                    update.content = newContent;
                    hasChanges = true;
                    log.info(`[Migration] Updating content for template: ${template['templateKey'] || template._id}`);
                }
            }
        }

        // Replace in subject field - exact match only
        if (template['subject'] && typeof template['subject'] === 'string') {
            if (template['subject'].includes(OLD_URL)) {
                // Use global replace to replace all occurrences
                const newSubject = template['subject'].replace(new RegExp(OLD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), NEW_URL);
                if (newSubject !== template['subject']) {
                    update.subject = newSubject;
                    hasChanges = true;
                    log.info(`[Migration] Updating subject for template: ${template['templateKey'] || template._id}`);
                }
            }
        }

        if (hasChanges) {
            const result = await collection.updateOne(
                { _id: template._id },
                { $set: update },
            );

            if (result.modifiedCount > 0) {
                updatedCount++;
                log.info(`[Migration] Successfully updated template: ${template['templateKey'] || template._id}`);
            }
            else {
                log.warn(`[Migration] Failed to update template: ${template['templateKey'] || template._id}`);
            }
        }
    }

    log.success(`[Migration] Successfully updated ${updatedCount} email template(s).`);
}

export async function down(db: C_Db) {
    const collection = db.collection('emailtemplates');

    log.info(`[Migration] Rolling back URL replacement in email templates: ${NEW_URL} -> ${OLD_URL}`);

    // Find all email templates that contain the new URL
    const templates = await collection.find({
        $or: [
            { content: { $regex: NEW_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
            { subject: { $regex: NEW_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        ],
    }).toArray();

    if (templates.length === 0) {
        log.info('[Migration] No email templates found with the new URL. Nothing to rollback.');
        return;
    }

    log.info(`[Migration] Found ${templates.length} email template(s) to rollback.`);

    let rolledBackCount = 0;

    for (const template of templates) {
        let hasChanges = false;
        const update: { content?: string; subject?: string } = {};

        // Replace in content field
        if (template['content'] && typeof template['content'] === 'string') {
            if (template['content'].includes(NEW_URL)) {
                const newContent = template['content'].replace(new RegExp(NEW_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), OLD_URL);
                if (newContent !== template['content']) {
                    update.content = newContent;
                    hasChanges = true;
                }
            }
        }

        // Replace in subject field
        if (template['subject'] && typeof template['subject'] === 'string') {
            if (template['subject'].includes(NEW_URL)) {
                const newSubject = template['subject'].replace(new RegExp(NEW_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), OLD_URL);
                if (newSubject !== template['subject']) {
                    update.subject = newSubject;
                    hasChanges = true;
                }
            }
        }

        if (hasChanges) {
            const result = await collection.updateOne(
                { _id: template._id },
                { $set: update },
            );

            if (result.modifiedCount > 0) {
                rolledBackCount++;
            }
        }
    }

    log.success(`[Migration] Successfully rolled back ${rolledBackCount} email template(s).`);
}
