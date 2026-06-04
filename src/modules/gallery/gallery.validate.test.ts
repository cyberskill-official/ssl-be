import { describe, expect, it, vi } from 'vitest';

import type { I_Context } from '#shared/typescript/index.js';

import { E_AgeVerifyStatus } from '#modules/authn/index.js';
import { E_Role } from '#modules/authz/role/role.type.js';

import type { I_Gallery } from './gallery.type.js';

const userCtrMock = vi.hoisted(() => ({
    getUser: vi.fn(),
}));

vi.mock('#modules/user/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#modules/user/index.js')>();

    return {
        ...actual,
        userCtr: userCtrMock,
    };
});

const { isUploaderAgeVerified } = await import('./gallery.validate.js');

describe('isUploaderAgeVerified', () => {
    it('does not refetch uploader when ageVerify and non-staff roles are already populated', async () => {
        const gallery = {
            uploadedById: 'user-1',
            uploadedBy: {
                id: 'user-1',
                ageVerify: { status: E_AgeVerifyStatus.PENDING },
                roles: [{ name: 'FREE_MEMBER' }],
            },
        } as I_Gallery;

        await expect(
            isUploaderAgeVerified({} as I_Context, gallery, new Map()),
        ).resolves.toBe(false);

        expect(userCtrMock.getUser).not.toHaveBeenCalled();
    });

    it('treats populated staff roles as verified without refetching uploader', async () => {
        const gallery = {
            uploadedById: 'staff-1',
            uploadedBy: {
                id: 'staff-1',
                ageVerify: { status: E_AgeVerifyStatus.PENDING },
                roles: [{ name: E_Role.STAFF }],
            },
        } as I_Gallery;

        await expect(
            isUploaderAgeVerified({} as I_Context, gallery, new Map()),
        ).resolves.toBe(true);

        expect(userCtrMock.getUser).not.toHaveBeenCalled();
    });

    it('does not refetch non-staff uploader when populated ageVerify is empty', async () => {
        const gallery = {
            uploadedById: 'user-2',
            uploadedBy: {
                id: 'user-2',
                ageVerify: undefined,
                roles: [{ name: 'FREE_MEMBER' }],
            },
        } as I_Gallery;

        await expect(
            isUploaderAgeVerified({} as I_Context, gallery, new Map()),
        ).resolves.toBe(false);

        expect(userCtrMock.getUser).not.toHaveBeenCalled();
    });
});
