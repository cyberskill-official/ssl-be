import type { AgeRange } from '@aws-sdk/client-rekognition';

import { Buffer } from 'node:buffer';

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
    return /\.jpe?g$|\.png$/i.test(filename);
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
        /^\d{4}-\d{2}-\d{2}$/, // ISO YYYY-MM-DD
        /^\d{2}\/\d{2}\/\d{4}$/, // DD/MM/YYYY or MM/DD/YYYY
        /^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
    ];

    let birth: Date | null = null;

    if (dateFormats[0].test(birthDate)) {
        // ISO format (YYYY-MM-DD)
        birth = new Date(birthDate);
    }
    else if (dateFormats[1].test(birthDate.replace(/-/g, '/'))) {
        // Ambiguous DD/MM/YYYY or MM/DD/YYYY
        const [a, b, year] = birthDate.replace(/-/g, '/').split('/').map(Number);

        if (
            typeof a === 'number' && !Number.isNaN(a)
            && typeof b === 'number' && !Number.isNaN(b)
            && typeof year === 'number' && !Number.isNaN(year)
        ) {
            const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : [1, 1];
            birth = new Date(year, month - 1, day);
        }
    }
    else if (dateFormats[2].test(birthDate.replace(/-/g, '/'))) {
        const [year, month, day] = birthDate.replace(/-/g, '/').split('/').map(Number);

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
 * Checks if ID age is within selfie age range and over 18
 * @param {number} idAge - Age from ID document
 * @param {object} selfieRange - AgeRange from verifyAgeSelfie
 * @returns {boolean} True if age is valid and within range, false otherwise
 * @description
 * - Validates that ID age is 18 or older
 * - Checks if ID age falls within the selfie age range
 * - Returns true if all conditions are met
 */
export function checkAge(idAge: number, selfieRange: AgeRange): boolean {
    if (
        idAge >= 18
        && typeof selfieRange.Low === 'number'
        && typeof selfieRange.High === 'number'
        && idAge >= selfieRange.Low
        && idAge <= selfieRange.High
    ) {
        return true;
    }

    return false;
}
