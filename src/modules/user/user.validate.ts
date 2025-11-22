import { E_AgeVerifyStatus } from '#modules/authn/authn.type.js';
import { E_Role, E_Role_Staff } from '#modules/authz/index.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';

import type { I_User } from './user.type.js';

export interface I_HydrateUserMediaOptions {
    viewerAgeVerified?: boolean;
    viewerIsStaff?: boolean;
    viewerIsAdmin?: boolean;
    viewerId?: string | null;
}

function shouldBlurProfile(
    _user?: I_User | null,
    options: I_HydrateUserMediaOptions = {},
): boolean {
    const viewerAgeVerified = options.viewerAgeVerified ?? false;
    const viewerIsStaff = options.viewerIsStaff ?? false;
    const viewerIsAdmin = options.viewerIsAdmin ?? false;

    const viewerExempt = viewerIsStaff || viewerIsAdmin;

    return !viewerAgeVerified && !viewerExempt;
}

function signProfileImage(
    url: string,
    user: I_User,
    options?: I_HydrateUserMediaOptions,
): string {
    if (shouldBlurProfile(user, options)) {
        return bunnyCtr.generateBlurredUrl({ fullUrl: url, extraQueryParams: { class: 'blur' } });
    }
    return bunnyCtr.generateSignedUrl({
        fullUrl: url,
        extraQueryParams: { class: 'normal' },
    });
}

export function hydrateUserMedia(
    user?: I_User | null,
    options?: I_HydrateUserMediaOptions,
): void {
    if (!user) {
        return;
    }

    const applyProfileMedia = (partner?: NonNullable<I_User['partner1']> | null) => {
        if (!partner) {
            return;
        }

        const rawGalleryUrl = partner.gallery?.url;

        const signedGallery = rawGalleryUrl
            ? signProfileImage(rawGalleryUrl, user, options)
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

export function getViewerMediaContext(user?: I_User | null): {
    mediaOptions: I_HydrateUserMediaOptions;
    isAdmin: boolean;
    isStaff: boolean;
} {
    const roles = Array.isArray(user?.roles) ? user?.roles : [];

    const isAdmin = roles.some(role =>
        role.name === E_Role_Staff.ADMIN
        || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes(E_Role_Staff.ADMIN)),
    );
    const isStaff = roles.some(role =>
        role.name === E_Role.STAFF
        || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes(E_Role.STAFF)),
    );

    return {
        mediaOptions: {
            viewerAgeVerified: user?.ageVerify?.status === E_AgeVerifyStatus.APPROVED,
            viewerIsAdmin: isAdmin,
            viewerIsStaff: isStaff,
            viewerId: user?.id ?? null,
        },
        isAdmin,
        isStaff,
    };
}
