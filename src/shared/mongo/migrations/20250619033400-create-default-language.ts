import type { C_Db } from '@cyberskill/shared/node/mongo';

import { readJsonSync } from '@cyberskill/shared/node/fs';
import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Language } from '#modules/language/language.type.js';

const PATH = `./src/shared/mongo/migrations/data`;
// Source: https://github.com/ihmpavel/all-iso-language-codes/blob/master/data/advanced.json

interface I_LanguageRaw extends Partial<I_Language> {
    '639-3'?: string;
    '639-2B'?: string;
    '639-2T'?: string;
    '639-1'?: string;
    'nativeName'?: string;
    'englishName'?: string;
}

const languages: I_LanguageRaw[] = readJsonSync(`${PATH}/languages.json`);

export async function up(db: C_Db) {
    const languageCtr = new MongoController<I_Language>(db, 'languages');

    const languagesToCreate: I_LanguageRaw[] = languages.map(language => ({
        code: (language['639-1'] ?? language['639-2B'] ?? language['639-2T'] ?? language['639-3']) as I_Language['code'],
        name: language.englishName,
        native: language.nativeName,
    }));

    const filteredLanguages = await mongo.getNewRecords(
        languageCtr,
        languagesToCreate as I_Language[],
        (existingLanguage, newLanguage) =>
            existingLanguage.name === newLanguage.name
            && existingLanguage.native === newLanguage.native,
    );

    if (filteredLanguages.length === 0) {
        log.info('No new languages to create. All languages already exist.');
        return;
    }

    const createdLanguages = await languageCtr.createMany(filteredLanguages);

    if (!createdLanguages.success) {
        return log.error('Failed to create some languages.');
    }

    log.success(`Successfully created ${filteredLanguages.length} new languages.`);
}

export async function down(db: C_Db) {
    const languageCtr = new MongoController<I_Language>(db, 'languages');

    const languagesToDelete = languages.map(language => ({
        name: language.englishName,
        native: language.nativeName,
    }));

    const existingLanguages = await mongo.getExistingRecords(
        languageCtr,
        languagesToDelete as I_Language[],
        (existingLanguage, deleteLanguage) =>
            existingLanguage.name === deleteLanguage.name
            && existingLanguage.native === deleteLanguage.native,
    );

    if (existingLanguages.length === 0) {
        log.info('No languages to delete. No matching languages found.');
        return;
    }

    const deleted = await languageCtr.deleteMany({
        id: { $in: existingLanguages.map(lang => lang.id) },
    });

    if (!deleted.success) {
        return log.error('Failed to delete languages.');
    }

    log.success(`Successfully deleted ${existingLanguages.length} languages.`);
}
