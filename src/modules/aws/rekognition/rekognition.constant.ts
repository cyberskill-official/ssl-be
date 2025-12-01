export const IMAGE_QUALITY_THRESHOLDS = {
    sharpness: 8,
    brightness: {
        low: 35,
        high: 110,
    },
};

// Face similarity threshold for age verification
// Lowered from 65 to 57 to reduce false rejections while maintaining reasonable security
// AWS Rekognition similarity scores range from 0-100:
// - 80-100: Very high confidence (very strict, high false rejection rate)
// - 60-80: High confidence (moderate-strict)
// - 50-60: Moderate confidence (balanced) - Current setting
// - Below 50: Low confidence (too lenient, security risk)
// 57 provides a good balance: reduces false rejections while still ensuring reasonable match confidence
// Fraudulent cases would be caught by payment provider verification and manual review
export const FACE_SIMILARITY_THRESHOLD = 80;
