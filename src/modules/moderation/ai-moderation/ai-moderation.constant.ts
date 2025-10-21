export const AI_MODERATION_DEFAULT_CONFIG = {
    awsComprehendEnabled: true,
    awsRekognitionEnabled: true,
    enableImageModeration: true,
    enableTextModeration: true,
    enableVideoModeration: true,
    autoRejectThreshold: 0.85,
    humanReviewThreshold: 0.65,
    imageThresholds: {
        explicitNudity: 0.9,
        violence: 0.7,
        hateSymbols: 0.8,
        drugs: 0.75,
        nonExplicitNudity: 0.95,
        swimwearOrUnderwear: 0.98,
        fullNudity: 0.98,
    },
};
