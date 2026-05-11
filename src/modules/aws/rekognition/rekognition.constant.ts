export const IMAGE_QUALITY_THRESHOLDS = {
    sharpness: 3,
    brightness: {
        low: 15,
        high: 130,
    },
};

// Face similarity threshold for age verification
// Lowered to 40 to significantly reduce false rejections
// AWS Rekognition similarity scores range from 0-100:
// - 80-100: Very high confidence (very strict, high false rejection rate)
// - 60-80: High confidence (moderate-strict)
// - 50-60: Moderate confidence (balanced)
// - 40-50: Lenient (fewer false rejections, still catches obvious mismatches)
// - Below 40: Too lenient (security risk)
// 40 prioritizes user experience: most legitimate users will pass automatically
// Fraudulent cases are caught by manual review and payment provider verification
export const FACE_SIMILARITY_THRESHOLD = 40;
