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

    // FREE_MEMBER check
    const viewerIsFreeMember = options?.viewerIsFreeMember ?? false;

    // Case 1: Owner chưa xác thực tuổi → trả null cho tất cả người xem khác (trừ owner/staff/admin)
    if (!ownerAgeVerified && !isOwner && !viewerExempt) {
        return null;
    }

    // Case 2: Viewer là FREE_MEMBER → luôn thấy ảnh người khác ở trạng thái blur
    if (viewerIsFreeMember && !isOwner && !viewerExempt) {
        return bunnyCtr.generateBlurredUrl({ fullUrl: url, extraQueryParams: { class: 'blur' } });
    }

    // Case 3: Còn lại (MEMBERSHIP hoặc owner/staff/admin) → hiển thị ảnh rõ
    return bunnyCtr.generateSignedUrl({
        fullUrl: url,
        extraQueryParams: { class: 'normal' },
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
            // Blur/unblur based on membership rules
            // - Owner can always see ảnh của họ (kể cả chưa xác thực tuổi)
            // - Nếu owner chưa xác thực tuổi: người khác sẽ thấy null
            // - FREE_MEMBER sẽ thấy ảnh người khác ở trạng thái blur
            // - MEMBERSHIP sẽ thấy ảnh rõ
            const signedGallery = signProfileImage(rawGalleryUrl, user, options);

            if (partner.gallery) {
                partner.gallery.url = signedGallery ?? undefined;
            }
        }
        else {
            // Even if there's no URL, we need to ensure gallery object exists
            // and URL is explicitly set to undefined for non-age-verified users
            // Check if owner is not age-verified and viewer is not owner/staff/admin
            const ownerAgeVerified = user?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            const viewerId = options?.viewerId;
            const isOwner = viewerId && user?.id && viewerId === user.id;
            const viewerIsStaff = options?.viewerIsStaff ?? false;
            const viewerIsAdmin = options?.viewerIsAdmin ?? false;
            const viewerExempt = viewerIsStaff || viewerIsAdmin;

            // If owner is not age-verified and viewer is not owner/staff/admin, ensure URL is undefined
            if (!ownerAgeVerified && !isOwner && !viewerExempt) {
                if (partner.gallery) {
                    partner.gallery.url = undefined;
                }
            }
        }
    };

    // Apply blur/unblur logic to both partner images based on owner's and viewer's age verification status
    // Non-verified viewers see blurred images of everyone else, but can see their own images clearly
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
        return name === E_Role_User.PAID_MEMBER || name === 'paid_mem';
    });
    // Check if user has free member role (supports legacy name FREE_MEM, case-insensitive)
    const hasFreeRole = roles.some((role) => {
        const name = typeof role?.name === 'string' ? role.name.toLowerCase() : '';
        return name === E_Role_User.FREE_MEMBER || name === 'free_mem';
    });

    // Import authnCtr to check membership status
    // We need to check if membership is active for paid members
    // Use dynamic import to avoid circular dependency and ES module issues
    let isMembershipActive = false;
    if (user) {
        try {
            isMembershipActive = authnCtr.isMembershipActive(user);
        }
        catch {
            // If import fails, assume membership is not active
            isMembershipActive = false;
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
