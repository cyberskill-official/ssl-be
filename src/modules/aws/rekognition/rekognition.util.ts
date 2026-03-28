import { Buffer } from 'node:buffer';

const IMAGE_EXT_REGEX = /\.jpe?g$|\.png$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DMY_MDY_DATE_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;
const YMD_DATE_REGEX = /^\d{4}\/\d{2}\/\d{2}$/;
const HYPHEN_REGEX = /-/g;
const NEWLINE_REGEX = /[\n\r]+/;
const SIX_DIGITS_REGEX = /^\d{6}$/;
const SIX_DIGIT_SEQ_REGEX = /(\d{6})/g;
const MRZ_LINE_REGEX = /^[A-Z0-9<]{30,44}$/m;
const MRZ_BIRTHDATE_REGEX = /[A-Z0-9<]{6,}\d{6}[A-Z0-9<]{6,}/;
const MRZ_PADDING_REGEX = /<{2,}/;

/**
 * Converts a readable stream to a Buffer
 * @param {NodeJS.ReadableStream} stream - The readable stream to convert
 * @returns {Promise<Buffer>} The buffer containing stream data
 */
export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

/**
 * Verifies if the file extension is a supported image format
 * @param {string} filename - The filename to check
 * @returns {boolean} True if the file is JPEG or PNG, false otherwise
 */
export function verifyImageExtension(filename: string): boolean {
    return IMAGE_EXT_REGEX.test(filename);
}
/**
 * Calculates age from birth date string supporting multiple formats
 * @param {string} birthDate - The birth date string to parse
 * @returns {number|null} The calculated age or null if parsing fails
 * @description
 * - DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD, DD-MM-YYYY, MM-DD-YYYY, YYYY-MM-DD
 * - Returns null if parsing fails
 */
export function calculateAgeFromBirthDate(birthDate: string): number | null {
    if (!birthDate) {
        return null;
    }

    const dateFormats: [RegExp, RegExp, RegExp] = [
        ISO_DATE_REGEX,
        DMY_MDY_DATE_REGEX,
        YMD_DATE_REGEX,
    ];

    let birth: Date | null = null;

    if (dateFormats[0].test(birthDate)) {
        // ISO format (YYYY-MM-DD)
        birth = new Date(birthDate);
    }
    else if (dateFormats[1].test(birthDate.replace(HYPHEN_REGEX, '/'))) {
        // Ambiguous DD/MM/YYYY or MM/DD/YYYY
        const [a, b, year] = birthDate.replace(HYPHEN_REGEX, '/').split('/').map(Number);

        if (
            typeof a === 'number' && !Number.isNaN(a)
            && typeof b === 'number' && !Number.isNaN(b)
            && typeof year === 'number' && !Number.isNaN(year)
        ) {
            const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [1, 1];
            birth = new Date(year, month - 1, day);
        }
    }
    else if (dateFormats[2].test(birthDate.replace(HYPHEN_REGEX, '/'))) {
        const [year, month, day] = birthDate.replace(HYPHEN_REGEX, '/').split('/').map(Number);

        if (
            typeof year === 'number' && !Number.isNaN(year)
            && typeof month === 'number' && !Number.isNaN(month)
            && typeof day === 'number' && !Number.isNaN(day)
        ) {
            birth = new Date(year, month - 1, day);
        }
    }
    else {
        const parsed = Date.parse(birthDate);

        if (!Number.isNaN(parsed)) {
            birth = new Date(parsed);
        }
    }

    if (!birth || Number.isNaN(birth.getTime())) {
        return null;
    }

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    const dayDiff = today.getDate() - birth.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
        age--;
    }

    return age;
}

/**
 * Extracts birth date from MRZ (Machine Readable Zone) code
 * @param {string} mrzText - The MRZ text to parse
 * @returns {string | null} The birth date in YYYY-MM-DD format or null if not found
 * @description
 * - Searches for MRZ pattern containing birth date (YYMMDD format)
 * - Converts 2-digit year to 4-digit year (assumes 1900s for years > 50, 2000s for years <= 50)
 * - Returns formatted date string or null if parsing fails
 */
export function extractBirthDateFromMRZ(mrzText: string): string | null {
    if (!mrzText) {
        return null;
    }

    // Split MRZ into lines and process the second line which typically contains personal data
    const lines = mrzText.split(NEWLINE_REGEX);

    for (const line of lines) {
        // For passport MRZ (TD3), the birth date is typically in positions 13-18 of the second line
        // Format: PPPPPPPPPCCCYYMMDDCSGGGGGGGGGGGGGCCCCCCCCCCCCCCCC
        // Where YYMMDD is the birth date

        if (line.length >= 18) {
            // Try extracting from standard MRZ position (characters 13-18)
            const standardBirthDate = line.substring(13, 19);
            if (SIX_DIGITS_REGEX.test(standardBirthDate)) {
                const parsed = parseMRZDate(standardBirthDate);
                if (parsed)
                    return parsed;
            }
        }

        // Fallback: Search for any 6-digit sequences that could be dates
        const mrzPattern = new RegExp(SIX_DIGIT_SEQ_REGEX.source, SIX_DIGIT_SEQ_REGEX.flags);
        const matches = line.match(mrzPattern);

        if (matches) {
            for (const match of matches) {
                const parsed = parseMRZDate(match);
                if (parsed)
                    return parsed;
            }
        }
    }

    return null;
}

/**
 * Helper function to parse and validate MRZ date format (YYMMDD)
 * @param {string} dateStr - 6-digit date string in YYMMDD format
 * @returns {string | null} Formatted date string or null if invalid
 */
function parseMRZDate(dateStr: string): string | null {
    if (!SIX_DIGITS_REGEX.test(dateStr)) {
        return null;
    }

    const year2 = Number.parseInt(dateStr.substring(0, 2), 10);
    const month = Number.parseInt(dateStr.substring(2, 4), 10);
    const day = Number.parseInt(dateStr.substring(4, 6), 10);

    // Convert 2-digit year to 4-digit year
    // Assume years > 50 are 1900s, years <= 50 are 2000s
    const year4 = year2 > 50 ? 1900 + year2 : 2000 + year2;

    // Validate date
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const testDate = new Date(year4, month - 1, day);
        if (testDate.getFullYear() === year4
            && testDate.getMonth() === month - 1
            && testDate.getDate() === day) {
            // Return in YYYY-MM-DD format
            return `${year4}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        }
    }

    return null;
}

/**
 * Checks if text contains MRZ pattern
 * @param {string} text - The text to check for MRZ pattern
 * @returns {boolean} True if MRZ pattern is detected, false otherwise
 */
export function containsMRZPattern(text: string): boolean {
    if (!text) {
        return false;
    }

    // MRZ patterns typically contain:
    // - Multiple lines of fixed-length alphanumeric characters
    // - Specific characters like '<' for padding
    // - Consistent format across lines
    const mrzPatterns = [
        MRZ_LINE_REGEX,
        MRZ_BIRTHDATE_REGEX,
        MRZ_PADDING_REGEX,
    ];

    return mrzPatterns.some(pattern => pattern.test(text));
}
