import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { fileURLToPath } from 'node:url';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';

fileURLToPath(import.meta.url); // keep for consistency with other migrations

const RECEIPT_DESCRIPTION_VAR = 'receiptDescription';

function updateVariablesList(value: unknown, includeVar: boolean): string[] {
    const variables = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    const hasVar = variables.includes(RECEIPT_DESCRIPTION_VAR);

    if (includeVar && !hasVar) {
        return [...variables, RECEIPT_DESCRIPTION_VAR];
    }
    if (!includeVar && hasVar) {
        return variables.filter(item => item !== RECEIPT_DESCRIPTION_VAR);
    }
    return variables;
}

export async function up(db: C_Db) {
    const collection = db.collection('emailtemplates');
    const existingTemplate = await collection.findOne({ templateKey: PAYMENT_SUCCESS });

    if (!existingTemplate) {
        log.warn('PAYMENT_SUCCESS template not found. Skipping update.');
        return;
    }

    const content = typeof existingTemplate['content'] === 'string' ? existingTemplate['content'] : '';
    if (!content) {
        log.warn('PAYMENT_SUCCESS template content is empty. Skipping update.');
        return;
    }

    const alreadyUpdated = content.includes('<%= receiptDescription %>');
    const updatedContent = alreadyUpdated
        ? content
        : content.replace('>Membership</td>', '><%= receiptDescription %></td>');

    const updateRes = await collection.updateOne(
        { templateKey: PAYMENT_SUCCESS },
        {
            $set: {
                content: updatedContent,
                variables: updateVariablesList(existingTemplate['variables'], true),
            },
        },
    );

    if (updateRes.modifiedCount > 0) {
        log.success('Successfully updated PAYMENT_SUCCESS email template with receipt description.');
    }
    else {
        log.warn('PAYMENT_SUCCESS email template was not modified (may already be up to date).');
    }
}

export async function down(db: C_Db) {
    const collection = db.collection('emailtemplates');
    const existingTemplate = await collection.findOne({ templateKey: PAYMENT_SUCCESS });

    if (!existingTemplate) {
        log.warn('PAYMENT_SUCCESS template not found. Skipping revert.');
        return;
    }

    const content = typeof existingTemplate['content'] === 'string' ? existingTemplate['content'] : '';
    if (!content) {
        log.warn('PAYMENT_SUCCESS template content is empty. Skipping revert.');
        return;
    }

    const updatedContent = content.replace('<%= receiptDescription %>', 'Membership');

    const updateRes = await collection.updateOne(
        { templateKey: PAYMENT_SUCCESS },
        {
            $set: {
                content: updatedContent,
                variables: updateVariablesList(existingTemplate['variables'], false),
            },
        },
    );

    if (updateRes.modifiedCount > 0) {
        log.success('Reverted PAYMENT_SUCCESS email template receipt description.');
    }
    else {
        log.warn('PAYMENT_SUCCESS email template was not modified (may already be reverted).');
    }
}
