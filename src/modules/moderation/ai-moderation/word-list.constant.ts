/**
 * Word lists for AI moderation
 * These lists are used to filter and categorize labels from AWS Rekognition
 *
 * Policy: Only reject content containing:
 * - Children/minors (Child, Infant, Toddler, Youth, etc.)
 * - Blood/gore/violence (Blood, Vivid Blood, Corpses, Emaciated Bodies, Graphic Violence, etc.)
 * - Weapons (Weapons, Gun, Knife, Weapon Violence, Physical Violence, Explosion, etc.)
 * - Hate symbols & Extremist (Hate Symbols, Extremist, Middle Finger, etc.)
 *
 * All other labels are allowed, including:
 * - Sexual content / nudity (explicit nudity, sexual activity, etc.)
 * - Adult content
 * - Clothing, underwear, lingerie
 * - Human body parts
 * - Any other adult-oriented content
 */

/**
 * Sexual content / nudity-related labels from AWS Rekognition
 * These labels are ALLOWED (not rejected) - they are detected but do not cause rejection
 * This list shows what sexual/nudity labels AWS Rekognition can detect
 */
export const SEXUAL_NUDITY_LABELS = [
    // Explicit nudity labels
    'explicit nudity',
    'illustrated explicit nudity',
    'graphic female nudity',
    'graphic male nudity',
    'nudity or sexual content',
    'adult explicit content',
    'sex toys',

    // Sexual activity labels
    'sexual activity',

    // Non-explicit nudity labels
    'nudity',
    'partial nudity',
    'implied nudity',
    'suggestive',

    // Swimwear/underwear labels
    'revealing clothes',
    'female swimwear or underwear',
    'male swimwear or underwear',
    'swimwear or underwear',
] as const;

/**
 * Weapon-related keywords that should trigger automatic rejection
 * Any label matching these keywords will cause the upload to be rejected
 * Based on AWS Rekognition moderation labels
 */
export const WEAPON_KEYWORDS = [
    'weapon',
    'weapons',
    'weapon violence',
    'gun',
    'guns',
    'knife',
    'knives',
    'physical violence',
    'firearm',
    'firearms',
    'rifle',
    'rifles',
    'pistol',
    'pistols',
    'handgun',
    'handguns',
    'sword',
    'swords',
    'blade',
    'blades',
    'ammunition',
    'ammo',
    'bullet',
    'bullets',
    'bomb',
    'bombs',
    'explosive',
    'explosives',
    'explosion',
    'grenade',
    'grenades',
    'artillery',
    'machine gun',
    'shotgun',
    'crossbow',
    'dagger',
    'mace',
    'torpedo',
    'missile',
] as const;

/**
 * Children/minor-related keywords that should trigger automatic rejection
 * Any label matching these keywords will cause the upload to be rejected
 * Based on AWS Rekognition General Labels (not in moderation CSV but always included)
 */
export const CHILDREN_KEYWORDS = [
    'child',
    'children',
    'infant',
    'infants',
    'toddler',
    'toddlers',
    'youth',
    'kid',
    'kids',
    'baby',
    'babies',
    'minor',
    'minors',
    'teen',
    'teenager',
    'teenagers',
    'adolescent',
    'adolescents',
    'boy',
    'boys',
    'girl',
    'girls',
    'newborn',
    'newborns',
    'schoolchild',
    'schoolchildren',
] as const;

/**
 * Blood/gore/violence-related keywords that should trigger automatic rejection
 * Any label matching these keywords will cause the upload to be rejected
 * Based on AWS Rekognition moderation labels
 */
export const BLOOD_GORE_KEYWORDS = [
    'blood',
    'bloody',
    'vivid blood',
    'gore',
    'gory',
    'violence',
    'violent',
    'graphic violence',
    'physical injury',
    'injury',
    'injuries',
    'self injury',
    'wound',
    'wounds',
    'bleeding',
    'bloodshed',
    'mutilation',
    'torture',
    'execution',
    'murder',
    'homicide',
    'assault',
    'fighting',
    'battle',
    'war',
    'warfare',
    'combat',
    'death',
    'dead',
    'corpse',
    'corpses',
    'cadaver',
    'emaciated bodies',
] as const;

/**
 * Hate symbols and extremist-related keywords that should trigger automatic rejection
 * Any label matching these keywords will cause the upload to be rejected
 * Based on AWS Rekognition moderation labels
 */
export const HATE_EXTREMIST_KEYWORDS = [
    'hate symbols',
    'hate symbol',
    'extremist',
    'extremism',
    'middle finger',
] as const;

/**
 * Check if a label name matches any weapon keyword
 */
export function isWeaponLabel(labelName: string): boolean {
    const normalized = labelName.toLowerCase().trim();
    return WEAPON_KEYWORDS.some(keyword =>
        normalized === keyword || normalized.includes(keyword),
    );
}

/**
 * Check if a label name matches any children/minor keyword
 */
export function isChildrenLabel(labelName: string): boolean {
    const normalized = labelName.toLowerCase().trim();
    return CHILDREN_KEYWORDS.some(keyword =>
        normalized === keyword || normalized.includes(keyword),
    );
}

/**
 * Check if a label name matches any blood/gore/violence keyword
 */
export function isBloodGoreLabel(labelName: string): boolean {
    const normalized = labelName.toLowerCase().trim();
    return BLOOD_GORE_KEYWORDS.some(keyword =>
        normalized === keyword || normalized.includes(keyword),
    );
}

/**
 * Check if a label name matches any hate symbols/extremist keyword
 */
export function isHateExtremistLabel(labelName: string): boolean {
    const normalized = labelName.toLowerCase().trim();
    return HATE_EXTREMIST_KEYWORDS.some(keyword =>
        normalized === keyword || normalized.includes(keyword),
    );
}

/**
 * Check if a label should be rejected (weapons, children, blood/gore, hate symbols/extremist)
 */
export function isRejectedLabel(labelName: string): boolean {
    return isWeaponLabel(labelName)
        || isChildrenLabel(labelName)
        || isBloodGoreLabel(labelName)
        || isHateExtremistLabel(labelName);
}

/**
 * Check if a label name is harmless (deprecated - all labels except rejected ones are allowed)
 * @deprecated Use isRejectedLabel instead - all labels are allowed except weapons, children, and blood/gore
 */
export function isHarmlessLabel(labelName: string): boolean {
    // All labels are harmless except rejected ones
    return !isRejectedLabel(labelName);
}
