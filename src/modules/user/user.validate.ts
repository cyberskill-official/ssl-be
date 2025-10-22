import { E_AgeVerifyStatus } from '#modules/authn/authn.type.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';

import type { I_User } from './user.type.js';

function shouldBlurProfile(user?: I_User | null): boolean {
    return user?.ageVerify?.status !== E_AgeVerifyStatus.APPROVED;
}

function signProfileImage(url: string, user: I_User): string {
    if (shouldBlurProfile(user)) {
        return bunnyCtr.generateBlurredUrl({ fullUrl: url });
    }
    return bunnyCtr.generateSignedUrl({
        fullUrl: url,
        extraQueryParams: { class: 'normal' },
    });
}

export function hydrateUserMedia(user?: I_User | null): void {
    if (!user) {
        return;
    }

    const applyProfileMedia = (partner?: NonNullable<I_User['partner1']> | null) => {
        if (!partner) {
            return;
        }

        const rawGalleryUrl = partner.gallery?.url;

        const signedGallery = rawGalleryUrl
            ? signProfileImage(rawGalleryUrl, user)
            : undefined;

        if (signedGallery && partner.gallery) {
            partner.gallery.url = signedGallery;
        }
    };

    applyProfileMedia(user.partner1);
    applyProfileMedia(user.partner2);

    if (user.ageVerify?.preApproval?.documentPic) {
        user.ageVerify.preApproval.documentPic = bunnyCtr.generateSignedUrl({
            fullUrl: user.ageVerify.preApproval.documentPic,
            extraQueryParams: { class: 'normal' },
        });
    }
    if (user.ageVerify?.preApproval?.selfiePic) {
        user.ageVerify.preApproval.selfiePic = bunnyCtr.generateSignedUrl({
            fullUrl: user.ageVerify.preApproval.selfiePic,
            extraQueryParams: { class: 'normal' },
        });
    }
}

const ADULT_AGE = 18;

function normalizeDate(input?: unknown): Date | null {
    if (!input) {
        return null;
    }
    if (input instanceof Date) {
        return Number.isNaN(input.getTime()) ? null : input;
    }
    const parsed = new Date(input as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isAdultDateOfBirth(dob?: unknown): boolean {
    const birthDate = normalizeDate(dob);
    if (!birthDate) {
        return false;
    }

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    const dayDiff = today.getDate() - birthDate.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
        age--;
    }

    return age >= ADULT_AGE;
}
