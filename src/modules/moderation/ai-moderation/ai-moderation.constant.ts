export const AI_MODERATION_DEFAULT_CONFIG = {
    awsComprehendEnabled: true,
    awsRekognitionEnabled: true,
    enableImageModeration: true,
    enableTextModeration: true,
    enableVideoModeration: true,
    autoRejectThreshold: 0.999,
    humanReviewThreshold: 0.65,
    imageThresholds: {
        // Explicit content - very high threshold to reduce false positives
        explicitNudity: 0.95, // Increased from 0.999 to catch real violations but reduce false positives
        fullNudity: 0.98, // Increased from 0.999
        violence: 0.85, // Increased from 0.7 to reduce false positives on action scenes
        hateSymbols: 0.90, // Increased from 0.8
        drugs: 0.90, // Increased from 0.75 to reduce false positives on innocent items

        // Non-explicit content - higher threshold to allow lifestyle content
        nonExplicitNudity: 0.95, // Reduced from 0.999 - allow artistic/lifestyle content
        swimwearOrUnderwear: 0.95, // Reduced from 0.98 - beach/pool photos are OK
    },
    videoThresholds: {
        // Video-specific thresholds (more lenient as context matters more in video)
        explicitNudity: 0.90,
        violence: 0.85,
        significantLabelConfidence: 70, // Increased from 60 to reduce false positives
        autoApproveMaxConfidence: 0.40, // Auto-approve videos with confidence < 40%
    },
};
