import type {
    I_Input_CreateOne,
    I_Input_DeleteMany,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_DeleteResult,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CheckVerification, I_Input_CreateVerification, I_Input_QueryVerification, I_Input_UpdateVerification, I_Result_CheckVerification, I_Verification } from './verification.type.js';

import { VerificationModel } from './verification.model.js';

const mongooseCtr = new MongooseController<I_Verification>(VerificationModel);

function normalizeVerificationId(document: I_Verification | null | undefined): string {
    return String(document?.id ?? (document as I_Verification & { _id?: unknown } | null | undefined)?._id ?? '').trim();
}

export const verificationCtr = {
    getVerification: async (
        _: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Verification>,
    ): Promise<I_Return<I_Verification>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getVerifications: async (
        _: I_Context,
        { filter, options }: I_Input_FindPaging<I_Verification>,
    ): Promise<I_Return<T_PaginateResult<I_Verification>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createVerification: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateVerification>,
    ): Promise<I_Return<I_Verification>> => {
        return mongooseCtr.createOne(doc);
    },
    updateVerification: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateVerification>,
    ): Promise<I_Return<I_Verification>> => {
        const verificationFound = await verificationCtr.getVerification(context, { filter });

        if (!verificationFound.success) {
            throwError({
                message: 'Verification not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const normalizedFilter = { ...filter } as Record<string, unknown>;
        if (Object.hasOwn(normalizedFilter, 'id')) {
            normalizedFilter['id'] = String(normalizedFilter['id'] ?? '').trim();
        }

        return mongooseCtr.updateOne(normalizedFilter, update, options);
    },
    deleteVerification: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryVerification>,
    ): Promise<I_Return<I_Verification>> => {
        const verificationFound = await verificationCtr.getVerification(context, { filter });

        if (!verificationFound.success) {
            throwError({
                message: 'Verification not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const normalizedFilter = { ...filter } as Record<string, unknown>;
        if (Object.hasOwn(normalizedFilter, 'id')) {
            normalizedFilter['id'] = String(normalizedFilter['id'] ?? '').trim();
        }

        return mongooseCtr.deleteOne(normalizedFilter, options);
    },
    deleteVerifications: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteMany<I_Input_QueryVerification>,
    ): Promise<I_Return<T_DeleteResult>> => {
        return mongooseCtr.deleteMany(filter, options);
    },
    checkVerification: async (
        context: I_Context,
        { identifier, value, method }: I_Input_CheckVerification,
    ): Promise<I_Return<I_Result_CheckVerification>> => {
        const verificationFound = await verificationCtr.getVerification(context, {
            filter: {
                identifier,
                ...(method && { method }),
            },
            options: { sort: { createdAt: -1 } },
        });

        if (!verificationFound.success) {
            throwError({
                message: 'Verification not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        if (verificationFound.result.expiresAt && new Date() > verificationFound.result.expiresAt) {
            throwError({
                message: 'Verification has expired.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const currentAttempts = verificationFound.result.attemptCount || 0;
        const maxAttempts = verificationFound.result.maxAttempts || 0;

        // Check if max attempts exceeded
        if (currentAttempts >= maxAttempts) {
            throwError({
                message: `Maximum verification attempts (${maxAttempts}) exceeded.`,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Increment attempt count
        const verificationId = normalizeVerificationId(verificationFound.result);

        await verificationCtr.updateVerification(context, {
            filter: { id: verificationId },
            update: { $inc: { attemptCount: 1 } },
        });

        const remainingAttempts = maxAttempts - (currentAttempts + 1);

        if (verificationFound.result.value !== value) {
            const errorMessage = remainingAttempts > 0
                ? `Invalid verification code. ${remainingAttempts} attempts remaining.`
                : 'Invalid verification code. No attempts remaining.';

            throwError({
                message: errorMessage,
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return {
            success: true,
            result: {
                isValid: true,
                verification: verificationFound.result,
                remainingAttempts,
            },
        };
    },
};
