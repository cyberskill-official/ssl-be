/**
 * Word lists for AI moderation
 * These lists are used to filter and categorize labels from AWS Rekognition
 *
 * Policy: Only reject content containing:
 * - Children/minors
 * - Blood/gore/violence
 * - Weapons
 *
 * All other labels are allowed.
 */

/**
 * Weapon-related keywords that should trigger automatic rejection
 * Any label matching these keywords will cause the upload to be rejected
 */
export const WEAPON_KEYWORDS = [
    'weapon',
    'weapons',
    'gun',
    'guns',
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
    'knife',
    'knives',
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
 */
export const CHILDREN_KEYWORDS = [
    'child',
    'children',
    'kid',
    'kids',
    'baby',
    'babies',
    'infant',
    'infants',
    'toddler',
    'toddlers',
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
 */
export const BLOOD_GORE_KEYWORDS = [
    'blood',
    'bloody',
    'gore',
    'gory',
    'violence',
    'violent',
    'graphic violence',
    'physical injury',
    'injury',
    'injuries',
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
    'cadaver',
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
 * Check if a label should be rejected (weapons, children, blood/gore)
 */
export function isRejectedLabel(labelName: string): boolean {
    return isWeaponLabel(labelName) || isChildrenLabel(labelName) || isBloodGoreLabel(labelName);
}

/**
 * Check if a label name is harmless (deprecated - all labels except rejected ones are allowed)
 * @deprecated Use isRejectedLabel instead - all labels are allowed except weapons, children, and blood/gore
 */
export function isHarmlessLabel(labelName: string): boolean {
    // All labels are harmless except rejected ones
    return !isRejectedLabel(labelName);
}
