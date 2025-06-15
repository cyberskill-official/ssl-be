import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Input_CreateTag, I_Input_QueryTag } from '#modules/tag/index.js';

import { E_TagType } from '#modules/tag/index.js';

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

    // Skin Tone
    { name: 'Light', type: E_TagType.SKIN_TONE },
    { name: 'Medium', type: E_TagType.SKIN_TONE },
    { name: 'Dark', type: E_TagType.SKIN_TONE },
    { name: 'Very Dark', type: E_TagType.SKIN_TONE },
];

export async function up(db: C_Db) {
    const tagCtr = new MongoController<I_Input_CreateTag>(db, 'tags');

    const existingTags = await tagCtr.findAll({
        name: { $in: tags.map(tag => tag.name) },
    });

    if (!existingTags.success) {
        return log.error('Failed to find existing tags.');
    }

    const existingTagNames = new Set(existingTags.result.map(tag => tag.name));

    const newTags = tags.filter(tag => !existingTagNames.has(tag.name));

    if (!newTags.length) {
        return log.info('No new tags to create.');
    }

    const createdTag = await tagCtr.createMany(newTags);

    if (!createdTag.success) {
        return log.error('Failed to create some tags.');
    }

    log.info('Tags created successfully.');
}

export async function down(db: C_Db) {
    const tagCtr = new MongoController<I_Input_QueryTag>(db, 'tags');

    const deleted = await tagCtr.deleteMany({ name: { $in: tags.map(tag => tag.name) } });

    if (!deleted.success) {
        return log.error('Failed to delete tags.');
    }

    log.success('Tags deleted successfully.');
}
