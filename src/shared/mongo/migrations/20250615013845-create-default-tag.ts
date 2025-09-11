import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Role } from '#modules/authz/role/role.type.js';
import type { I_Tag } from '#modules/tag/tag.type.js';

import { E_Role_Staff } from '#modules/authz/role/role.type.js';
import { E_TagType } from '#modules/tag/tag.type.js';

const tags = [
    // What are you looking for
    { name: 'Couples', type: E_TagType.LOOKING_FOR },
    { name: 'Female', type: E_TagType.LOOKING_FOR },
    { name: 'Man', type: E_TagType.LOOKING_FOR },

    // What are your purpose of this profile
    { name: 'Swingerclub', type: E_TagType.PROFILE_PURPOSE },
    { name: 'Party', type: E_TagType.PROFILE_PURPOSE },
    { name: 'Private meeting', type: E_TagType.PROFILE_PURPOSE },
    { name: 'Dogging', type: E_TagType.PROFILE_PURPOSE },
    { name: 'Dating', type: E_TagType.PROFILE_PURPOSE },
    { name: 'Curious', type: E_TagType.PROFILE_PURPOSE },

    // How far are you willing to go
    { name: 'Full swap', type: E_TagType.WILLINGNESS_TO_GO },
    { name: 'Soft swap', type: E_TagType.WILLINGNESS_TO_GO },
    { name: 'No swap', type: E_TagType.WILLINGNESS_TO_GO },
    { name: 'Orgy', type: E_TagType.WILLINGNESS_TO_GO },
    { name: 'Cuckold', type: E_TagType.WILLINGNESS_TO_GO },
    { name: 'Chemistry meeting', type: E_TagType.WILLINGNESS_TO_GO },

    // Rules of engagement
    { name: 'Sex in closed room', type: E_TagType.RULES_OF_ENGAGEMENT },
    { name: 'No kissing', type: E_TagType.RULES_OF_ENGAGEMENT },
    { name: 'Safewords', type: E_TagType.RULES_OF_ENGAGEMENT },
    { name: 'No phone numbers', type: E_TagType.RULES_OF_ENGAGEMENT },
    { name: 'Condom', type: E_TagType.RULES_OF_ENGAGEMENT },

    // Relationship Status
    { name: 'In a relationship', type: E_TagType.RELATIONSHIP_STATUS },
    { name: 'Single', type: E_TagType.RELATIONSHIP_STATUS },

    // Sex orientation
    { name: 'Hetrosexual', type: E_TagType.SEXUAL_ORIENTATION },
    { name: 'Homosexual', type: E_TagType.SEXUAL_ORIENTATION },
    { name: 'Bisexual', type: E_TagType.SEXUAL_ORIENTATION },

    // What kind of sex are you into
    { name: 'Vanilla', type: E_TagType.SEXUAL_PREFERENCES },
    { name: 'Hard', type: E_TagType.SEXUAL_PREFERENCES },
    { name: 'SM', type: E_TagType.SEXUAL_PREFERENCES },
    { name: 'Dominans', type: E_TagType.SEXUAL_PREFERENCES },
    { name: 'Submissiv', type: E_TagType.SEXUAL_PREFERENCES },
    { name: 'Kinky', type: E_TagType.SEXUAL_PREFERENCES },
    { name: 'Anal', type: E_TagType.SEXUAL_PREFERENCES },
    { name: 'Sandwich', type: E_TagType.SEXUAL_PREFERENCES },

    // Smoking
    { name: 'Smoke', type: E_TagType.SMOKING_HABITS },
    { name: 'Non smoker', type: E_TagType.SMOKING_HABITS },
    { name: 'Vape', type: E_TagType.SMOKING_HABITS },
    { name: 'Plants', type: E_TagType.SMOKING_HABITS },

    // Preferred drinks
    { name: 'Cocktail', type: E_TagType.PREFERRED_DRINKS },
    { name: 'Wine', type: E_TagType.PREFERRED_DRINKS },
    { name: 'Beer', type: E_TagType.PREFERRED_DRINKS },
    { name: 'Coffee', type: E_TagType.PREFERRED_DRINKS },
    { name: 'Tea', type: E_TagType.PREFERRED_DRINKS },

    // Body Type
    { name: 'Slim', type: E_TagType.BODY_TYPE },
    { name: 'Athletic', type: E_TagType.BODY_TYPE },
    { name: 'Average', type: E_TagType.BODY_TYPE },
    { name: 'Curvy', type: E_TagType.BODY_TYPE },
    { name: 'Muscular', type: E_TagType.BODY_TYPE },
    { name: 'Full-figured', type: E_TagType.BODY_TYPE },
    { name: 'Plus-size', type: E_TagType.BODY_TYPE },

    // Height
    { name: `Under 160 cm (5'3")`, type: E_TagType.HEIGHT },
    { name: `160-170 cm (5'3"-5'7")`, type: E_TagType.HEIGHT },
    { name: `170-180 cm (5'7"-5'11")`, type: E_TagType.HEIGHT },
    { name: `180-190 cm (5'11"-6'3")`, type: E_TagType.HEIGHT },
    { name: `Over 190 cm (6'3"+)`, type: E_TagType.HEIGHT },

    // Hair Color
    { name: 'Black', type: E_TagType.HAIR_COLOR },
    { name: 'Brown', type: E_TagType.HAIR_COLOR },
    { name: 'Blonde', type: E_TagType.HAIR_COLOR },
    { name: 'Red', type: E_TagType.HAIR_COLOR },
    { name: 'Grey', type: E_TagType.HAIR_COLOR },
    { name: 'Bald', type: E_TagType.HAIR_COLOR },
    { name: 'Dyed (e.g. pink, blue, etc.)', type: E_TagType.HAIR_COLOR },

    // Eye Color
    { name: 'Brown', type: E_TagType.EYE_COLOR },
    { name: 'Blue', type: E_TagType.EYE_COLOR },
    { name: 'Green', type: E_TagType.EYE_COLOR },
    { name: 'Hazel', type: E_TagType.EYE_COLOR },
    { name: 'Grey', type: E_TagType.EYE_COLOR },

    // Ethnicity
    { name: 'White', type: E_TagType.ETHNICITY },
    { name: 'Black', type: E_TagType.ETHNICITY },
    { name: 'Latin', type: E_TagType.ETHNICITY },
    { name: 'Middle Eastern', type: E_TagType.ETHNICITY },
    { name: 'Asian', type: E_TagType.ETHNICITY },
    { name: 'Mixed', type: E_TagType.ETHNICITY },

    // Catalogue
    { name: 'Big city', type: E_TagType.CATALOGUE },
    { name: 'European city', type: E_TagType.CATALOGUE },
    { name: 'South Europe', type: E_TagType.CATALOGUE },
    { name: 'Beach', type: E_TagType.CATALOGUE },
    { name: 'Island', type: E_TagType.CATALOGUE },
    { name: 'Nature', type: E_TagType.CATALOGUE },
    { name: 'BDSM', type: E_TagType.CATALOGUE },
    { name: 'Soft', type: E_TagType.CATALOGUE },
    { name: 'Chemistry', type: E_TagType.CATALOGUE },
    { name: 'Drinks', type: E_TagType.CATALOGUE },
    { name: 'Spontaneous' },
    { name: 'Passion', type: E_TagType.CATALOGUE },
    { name: 'Orgy', type: E_TagType.CATALOGUE },
    { name: 'Masquerade', type: E_TagType.CATALOGUE },
    { name: 'Dinner party', type: E_TagType.CATALOGUE },
    { name: 'Holidays', type: E_TagType.CATALOGUE },
    { name: 'House party', type: E_TagType.CATALOGUE },
];

export async function up(db: C_Db) {
    const tagCtr = new MongoController<I_Tag>(db, 'tags');
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const admin = await roleCtr.findOne({ name: E_Role_Staff.ADMIN });

    if (!admin.success) {
        return log.error('Admin role not found.');
    }

    const tagsToCreate = tags.map(tag => ({ ...tag, createdById: admin.result.id }));

    const filteredTags = await mongo.getNewRecords(
        tagCtr,
        tagsToCreate as I_Tag[],
        (existingTag, newTag) =>
            existingTag.name === newTag.name && existingTag.type === newTag.type,
    );

    if (filteredTags.length === 0) {
        log.info('No new tags to create. All tags already exist.');
        return;
    }

    const createdTag = await tagCtr.createMany(filteredTags);

    if (!createdTag.success) {
        return log.error('Failed to create some tags.');
    }

    log.success(`Successfully created ${filteredTags.length} new tags.`);
}

export async function down(db: C_Db) {
    const tagCtr = new MongoController<I_Tag>(db, 'tags');

    const tagsToDelete = tags.map(tag => ({ name: tag.name, type: tag.type }));

    const existingTags = await mongo.getExistingRecords(
        tagCtr,
        tagsToDelete as I_Tag[],
        (existingTag, deleteTag) =>
            existingTag.name === deleteTag.name && existingTag.type === deleteTag.type,
    );

    if (existingTags.length === 0) {
        log.info('No tags to delete. No matching tags found.');
        return;
    }

    const deleted = await tagCtr.deleteMany({
        id: { $in: existingTags.map(tag => tag.id) },
    });

    if (!deleted.success) {
        return log.error('Failed to delete tags.');
    }

    log.success(`Successfully deleted ${existingTags.length} tags.`);
}
