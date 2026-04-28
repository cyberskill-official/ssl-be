import { authnCtr } from '#modules/authn/authn.controller.js';
import { E_AgeVerifyStatus } from '#modules/authn/authn.type.js';
import { E_Role, E_Role_Staff, E_Role_User } from '#modules/authz/index.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';

import type { I_User } from './user.type.js';

export interface I_HydrateUserMediaOptions {
    viewerAgeVerified?: boolean;
    viewerIsStaff?: boolean;
    viewerIsAdmin?: boolean;
    viewerId?: string | null;
    viewerIsPaidMember?: boolean;
    viewerIsFreeMember?: boolean;
}

function signProfileImage(
    url: string,
    user: I_User,
    options?: I_HydrateUserMediaOptions,
): string | null {
    // Check if owner (person whose profile is being viewed) is age-verified
    const ownerAgeVerified = user?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;

    // Check if viewer is the owner (viewing their own profile)
    const viewerId = options?.viewerId;
    const isOwner = viewerId && user?.id && viewerId === user.id;

    // Staff and admin can always see unblurred profile pictures
    const viewerIsStaff = options?.viewerIsStaff ?? false;
    const viewerIsAdmin = options?.viewerIsAdmin ?? false;
    const viewerExempt = viewerIsStaff || viewerIsAdmin;

    // Membership checks
    const viewerIsPaidMember = options?.viewerIsPaidMember ?? false;

    // Case 1: Owner chưa xác thực tuổi → owner thấy blur, người khác thấy null (default image)
    // Case 1: Owner not age-verified -> EVERYONE sees blurred image (not default)
    if (!ownerAgeVerified) {
        // Staff/admin can see clear images even if owner is not verified
        if (viewerExempt) {
            return bunnyCtr.generateSignedUrl({
                fullUrl: url,
                extraQueryParams: { class: 'normal' },
            });
        }

        // Everyone else (including owner) sees blurred image
        // UX improvement: Show blurred image instead of default to encourage age verification
        return bunnyCtr.generateBlurredUrl({ fullUrl: url, extraQueryParams: { class: 'blur' } });
    }

    // Case 2: All logged-in users (free or paid) can see profile pictures clearly
    // This allows free users to browse the platform and see who's available
    // Gallery photos remain blurred for free members (handled in gallery.controller.ts)
    // Business requirement: Free users must see profile pictures to encourage platform exploration
    const membershipClass = isOwner
        ? 'normal'
        : (viewerIsPaidMember ? 'premium' : 'free');

    return bunnyCtr.generateSignedUrl({
        fullUrl: url,
        extraQueryParams: { class: membershipClass },
    });
}

export function hydrateUserMedia(
    user?: I_User,
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

        // If there's a URL, sign/blur it based on age verification
        if (rawGalleryUrl) {
            // Profile picture visibility rules:
            // - Owner not age-verified: EVERYONE (including owner) sees blurred image
            // - Owner age-verified: ALL logged-in users (free or paid) see profile pictures clearly
            // - Gallery photos remain blurred for free members (handled in gallery.controller.ts)
            // - Staff/admin always see clear images
            // Business requirement: Show blurred images instead of default to encourage age verification
            const signedGallery = signProfileImage(rawGalleryUrl, user, options);

            if (partner.gallery) {
                partner.gallery.url = signedGallery ?? undefined;
            }
            else {
                // If gallery object doesn't exist, create it
                partner.gallery = { url: signedGallery ?? undefined } as any;
            }
        }
        else {
            // No URL exists - user hasn't uploaded a profile picture yet
            // Frontend will show default image
        }
    };

    // Apply blur/unblur logic to both partner images based on owner's age verification status
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

    // Check if user has paid member role (supports legacy name PAID_MEM, case-insensitive)
    const hasPaidRole = roles.some((role) => {
        const name = typeof role?.name === 'string' ? role.name.toLowerCase() : '';
        return name === E_Role_User.PAID_MEMBER.toLowerCase()
            || name === E_Role_User.PROMO_MEMBER.toLowerCase()
            || name === 'paid_member';
    });
    // Check if user has free member role (supports legacy name FREE_MEM, case-insensitive)
    const hasFreeRole = roles.some((role) => {
        const name = typeof role?.name === 'string' ? role.name.toLowerCase() : '';
        return name === E_Role_User.FREE_MEMBER.toLowerCase() || name === 'free_mem';
    });

    // Membership active detection (treat missing expiry as active for paid members)
    const expiresAt = user?.membershipExpiresAt !== undefined
        ? user?.membershipExpiresAt
        : (user as any)?.membershipEndDate;
    let isMembershipActive = false;
    if (hasPaidRole) {
        if (expiresAt === undefined) {
            isMembershipActive = true;
        }
        else if (expiresAt === null) {
            isMembershipActive = false;
        }
        else {
            try {
                isMembershipActive = authnCtr.isMembershipActive(user as I_User);
            }
            catch {
                isMembershipActive = new Date(expiresAt) > new Date();
            }
        }
    }

    const viewerIsPaidMember = hasPaidRole && isMembershipActive;
    let viewerIsFreeMember = hasFreeRole || (hasPaidRole && !isMembershipActive);

    // Safety: if we cannot determine roles, default to FREE to avoid leaking clear images
    if (!viewerIsPaidMember && !viewerIsFreeMember) {
        viewerIsFreeMember = true;
    }

    return {
        mediaOptions: {
            viewerAgeVerified: user?.ageVerify?.status === E_AgeVerifyStatus.APPROVED,
            viewerIsAdmin: isAdmin,
            viewerIsStaff: isStaff,
            viewerId: user?.id ?? null,
            viewerIsPaidMember,
            viewerIsFreeMember,
        },
        isAdmin,
        isStaff,
    };
}
