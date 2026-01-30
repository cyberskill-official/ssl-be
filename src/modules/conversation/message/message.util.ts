import type { T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';
import { escapeRegExp } from 'lodash-es';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr, E_AgeVerifyStatus } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { ModerationLogModel } from '#modules/moderation/moderation-log/moderation-log.model.js';
import { E_ModerationLogAction } from '#modules/moderation/moderation-log/moderation-log.type.js';
import { userCtr } from '#modules/user/user.controller.js';
import { UserModel } from '#modules/user/user.model.js';
import { getViewerMediaContext, hydrateUserMedia } from '#modules/user/user.validate.js';
import { hasToObject } from '#shared/util/has-to-object.js';

import type { I_Message } from './message.type.js';

import { E_MessageType } from './message.type.js';

const mongooseCtr = new MongooseController(UserModel);

function toPlain<T>(input: T): T {
    if (hasToObject(input)) {
        try {
            const plain = input.toObject();
            return (plain ?? input) as T;
        }
        catch {
            return input as T;
        }
    }
    return input;
}

function maskLexicalText(jsonStr: string, pattern: RegExp): string {
    if (!jsonStr.trim().startsWith('{'))
        return jsonStr.replace(pattern, '*****');

    try {
        const root = JSON.parse(jsonStr);
        const recursiveMask = (node: any) => {
            if (!node || typeof node !== 'object')
                return;

            if (node.type === 'text' && typeof node.text === 'string') {
                node.text = node.text.replace(pattern, '*****');
            }

            if (Array.isArray(node.children)) {
                node.children.forEach(recursiveMask);
            }
        };
        recursiveMask(root);
        return JSON.stringify(root);
    }
    catch {
        // Fallback to raw replacement if JSON is invalid but looked like JSON
        return jsonStr.replace(pattern, '*****');
    }
}

export function extractLexicalText(jsonStr: string | null | undefined): string {
    if (!jsonStr)
        return '';
    const trimmed = jsonStr.trim();
    if (!trimmed.startsWith('{'))
        return trimmed;

    try {
        const root = JSON.parse(trimmed);
        let textResult = '';
        const recursiveExtract = (node: any) => {
            if (!node || typeof node !== 'object')
                return;

            if (node.type === 'text' && typeof node.text === 'string') {
                textResult += (textResult ? ' ' : '') + node.text;
            }

            if (Array.isArray(node.children)) {
                node.children.forEach(recursiveExtract);
            }
        };
        recursiveExtract(root);
        return textResult;
    }
    catch {
        // Fallback to raw string if JSON is invalid
        return trimmed;
    }
}

function maybeSignVideoUrl(context: I_Context, url: unknown): string | undefined {
    if (typeof url !== 'string' || url.length === 0)
        return undefined;

    try {
        return bunnyCtr.generateEmbedIframeUrlFromUrl({
            fullUrl: url,
            remoteIp: context.req?.ip,
        });
    }
    catch {
        return undefined;
    }
}

export async function transformMessageMedia(context: I_Context, message: I_Message | null | undefined): Promise<I_Message | null | undefined> {
    if (!message)
        return message;

    const plainMessage = toPlain(message);
    if (!plainMessage)
        return plainMessage;

    const content = plainMessage.content ? { ...plainMessage.content } : undefined;

    // Get viewer once for use in multiple checks
    let viewer = null;
    let sessionUser: any = null;
    try {
        viewer = await authnCtr.getUserFromSession(context);

        // Fetch full session user data with roles and ageVerify for media hydration
        if (viewer?.id) {
            const sessionUserPopulated = await mongooseCtr.findOne(
                { id: viewer.id },
                {
                    id: 1,
                    roles: 1,
                    rolesIds: 1,
                    ageVerify: 1,
                    membershipExpiresAt: 1,
                    membershipEndDate: 1,
                    partner1: 1,
                    partner2: 1,
                } as any,
                undefined,
                [
                    { path: 'roles' },
                    { path: 'ageVerify' },
                    {
                        path: 'partner1',
                        populate: [{ path: 'gallery' }],
                    },
                    {
                        path: 'partner2',
                        populate: [{ path: 'gallery' }],
                    },
                ],
            );
            if (sessionUserPopulated.success && sessionUserPopulated.result) {
                sessionUser = sessionUserPopulated.result;
            }
            else {
                sessionUser = viewer;
            }
        }
    }
    catch {
        viewer = null;
        sessionUser = null;
    }

    const { mediaOptions: viewerMediaOptions } = getViewerMediaContext(sessionUser);

    if (content?.type === E_MessageType.VIDEO) {
        // Re-sign video URL with current viewer's IP to avoid 403 errors
        // Only re-sign if URL has remote_ip restriction or if token is expired/missing
        if (typeof content.value === 'string' && content.value) {
            try {
                const url = new URL(content.value);
                // Check if this is a Bunny embed URL
                const isBunnyEmbed = url.hostname === 'iframe.mediadelivery.net' && url.pathname.startsWith('/embed/');

                if (isBunnyEmbed) {
                    const hasRemoteIp = url.searchParams.has('remote_ip');
                    const expiresParam = url.searchParams.get('expires');
                    const hasToken = url.searchParams.has('token');

                    // Check if token is expired (expires is in seconds since epoch)
                    const isExpired = expiresParam ? Number.parseInt(expiresParam, 10) < Math.floor(Date.now() / 1000) : true;

                    // Re-sign if: has remote_ip restriction, token is missing, or token is expired
                    if (hasRemoteIp || !hasToken || isExpired) {
                        // Remove existing token, expires, and remote_ip params to get base URL
                        url.searchParams.delete('token');
                        url.searchParams.delete('expires');
                        url.searchParams.delete('remote_ip');
                        const baseUrl = url.toString();
                        const signed = maybeSignVideoUrl(context, baseUrl);
                        if (signed)
                            content.value = signed;
                    }
                    // If URL has valid token and no remote_ip restriction, use it as-is
                }
                else {
                    // If not a Bunny embed URL, try signing the original value
                    const signed = maybeSignVideoUrl(context, content.value);
                    if (signed)
                        content.value = signed;
                }
            }
            catch {
                // If URL parsing fails, try signing the original value
                const signed = maybeSignVideoUrl(context, content.value);
                if (signed)
                    content.value = signed;
            }
        }
    }
    else if (content?.type === E_MessageType.IMAGE) {
        if (typeof content.value === 'string' && content.value) {
            // Get sender and ensure it has ageVerify and roles populated
            let sender = plainMessage.sender;

            // Populate sender if needed
            if (sender && (!sender.ageVerify || !sender.roles)) {
                try {
                    const senderPopulated = await userCtr.getUser(context as any, {
                        filter: { id: sender.id || plainMessage.senderId },
                        projection: { ageVerify: 1, roles: 1, membershipEndDate: 1 },
                    });
                    if (senderPopulated.success && senderPopulated.result) {
                        sender = {
                            ...sender,
                            ageVerify: senderPopulated.result.ageVerify,
                            roles: senderPopulated.result.roles,
                            membershipEndDate: (senderPopulated.result as any).membershipEndDate,
                        } as any;
                    }
                }
                catch {
                    // If fetch fails, continue with existing sender data
                }
            }

            const senderAgeVerified = sender?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            const viewerId = viewer?.id;
            const senderId = plainMessage.senderId;
            const isOwner = viewerId && senderId && viewerId === senderId;

            // Check if viewer is staff/admin
            // Use sessionUser instead of viewer because sessionUser has roles populated
            const rolesForExemptCheck = sessionUser?.roles || viewer?.roles || [];
            const viewerIsStaff = (Array.isArray(rolesForExemptCheck) && rolesForExemptCheck.some((role: any) => role.name === 'STAFF' || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes('STAFF')))) ?? false;
            const viewerIsAdmin = (Array.isArray(rolesForExemptCheck) && rolesForExemptCheck.some((role: any) => role.name === 'ADMIN' || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes('ADMIN')))) ?? false;
            const viewerExempt = viewerIsStaff || viewerIsAdmin;

            // Check viewer's membership status (not sender's)
            // Use sessionUser instead of viewer because sessionUser has roles populated
            const viewerRoles = Array.isArray(sessionUser?.roles) ? sessionUser?.roles : (Array.isArray(viewer?.roles) ? viewer?.roles : []);
            const viewerHasFreeRole = viewerRoles.some((role: any) => role.name === 'FREE_MEMBER') ?? false;
            const viewerHasPaidRole = viewerRoles.some((role: any) =>
                role.name === 'PAID_MEMBER' || role.name === 'PROMO_MEMBER',
            ) ?? false;
            let viewerMembershipActive = false;
            try {
                // Use sessionUser for membership check if available, otherwise use viewer
                const userForMembershipCheck = sessionUser || viewer;
                viewerMembershipActive = userForMembershipCheck ? authnCtr.isMembershipActive(userForMembershipCheck) : false;
            }
            catch {
                viewerMembershipActive = false;
            }
            const viewerIsFreeMember = viewerHasFreeRole || (viewerHasPaidRole && !viewerMembershipActive);

            // Case 1: Sender chưa xác thực tuổi → người khác thấy null (owner/staff/admin vẫn thấy rõ)
            if (!senderAgeVerified && !isOwner && !viewerExempt) {
                content.value = null as any; // Show default image for other viewers
            }
            // Case 2: Viewer là FREE_MEMBER → blur ảnh của người khác
            else if (viewerIsFreeMember && !isOwner && !viewerExempt) {
                content.value = bunnyCtr.generateBlurredUrl({ fullUrl: content.value, extraQueryParams: { class: 'blur' } });
                try {
                    const { log } = await import('@cyberskill/shared/node/log');
                    log.warn('[MESSAGE][transformMessageMedia] blur image for free viewer', {
                        viewerId: viewerId ?? sessionUser?.id,
                        senderId,
                        isOwner,
                        viewerIsFreeMember,
                        viewerExempt,
                    });
                }
                catch {
                    // ignore logging failures
                }
            }
            // Case 3: MEMBERSHIP hoặc owner/staff/admin → ảnh rõ
            else {
                try {
                    const { log } = await import('@cyberskill/shared/node/log');
                    log.warn('[MESSAGE][transformMessageMedia] image not blurred', {
                        reason: senderAgeVerified ? 'senderAgeVerified or viewer exempt/owner' : 'unknown',
                        viewerId: viewerId ?? sessionUser?.id,
                        senderId,
                        isOwner,
                        viewerIsFreeMember,
                        viewerExempt,
                        senderAgeVerified,
                    });
                }
                catch {
                    // ignore logging failures
                }

                content.value = bunnyCtr.generateSignedUrl({ fullUrl: content.value, extraQueryParams: { class: 'normal' } });
            }
        }
    }

    if (content?.contactAdmin && typeof content.contactAdmin.image === 'string') {
        const trimmed = content.contactAdmin.image.trim();
        if (trimmed) {
            const contactAdmin = { ...content.contactAdmin };
            contactAdmin.image = bunnyCtr.generateSignedUrl({ fullUrl: trimmed, extraQueryParams: { class: 'normal' } });
            content.contactAdmin = contactAdmin;
        }
    }

    // Check if message has pending keyword moderation (needs redaction)
    // Only redact for other users, not the sender
    let shouldRedactKeywords = false;
    let keywordToRedact: string | null = null;
    const messageId = plainMessage.id || (plainMessage._id ? String(plainMessage._id) : undefined);
    if (content?.type === E_MessageType.TEXT && messageId && plainMessage.senderId) {
        try {
            const viewerId = viewer?.id;

            // Redact for all users if keyword detected
            if (viewerId) {
                // Check if message has WARN log (keyword detected) and no APPROVE log
                // USE DIRECT QUERY to bypass user permission filters in moderationLogCtr
                const warnLogs = await ModerationLogModel.find({
                    messageId,
                    action: E_ModerationLogAction.WARN,
                }).lean();

                if (warnLogs && warnLogs.length > 0) {
                    // Check if there's an APPROVE log for this message
                    const approveLogs = await ModerationLogModel.find({
                        messageId,
                        action: E_ModerationLogAction.APPROVE,
                    }).lean();

                    // If no APPROVE log exists, message is still pending moderation - redact keyword
                    if (!approveLogs || approveLogs.length === 0) {
                        shouldRedactKeywords = true;
                        // Extract keyword from reason field
                        // Format: "Message contains keyword: "xxx" (category: xxx)"
                        const reason = warnLogs[0]?.reason || '';
                        const match = reason.match(/keyword: "([^"]+)"/);
                        if (match && match[1]) {
                            keywordToRedact = match[1];
                        }
                    }
                }
            }
        }
        catch {
            // Non-fatal: if moderation check fails, don't redact
        }
    }

    // Redact keyword in message content if needed
    if (shouldRedactKeywords && keywordToRedact && content?.type === E_MessageType.TEXT && typeof content.value === 'string') {
        const hasSpecialChars = /[^\w\s]/.test(keywordToRedact);
        const keywordPattern = hasSpecialChars
            ? new RegExp(escapeRegExp(keywordToRedact), 'gi')
            : new RegExp(`\\b${escapeRegExp(keywordToRedact)}\\b`, 'gi');

        content.value = maskLexicalText(content.value, keywordPattern);
    }

    // Transform sender avatar using hydrateUserMedia
    // Handle both Mongoose Document and plain object
    let sender = plainMessage.sender;
    if (sender) {
        try {
            // Transform sender avatars (partner1 and partner2)
            const plainSender = (sender as any).toObject ? (sender as any).toObject() : sender;
            let transformedSender = { ...plainSender };

            // Ensure ageVerify, roles, and galleries are populated for blur logic to work correctly
            // Always check if galleries are missing, even if other fields are present
            // Check if gallery objects exist but are null (not populated) or if gallery.url is missing
            const partner1GalleryMissing = !transformedSender.partner1?.gallery
                || (transformedSender.partner1?.gallery && !transformedSender.partner1.gallery.url);
            const partner2GalleryMissing = !transformedSender.partner2?.gallery
                || (transformedSender.partner2?.gallery && !transformedSender.partner2.gallery.url);

            const needsPopulate = !transformedSender.ageVerify
                || !transformedSender.roles
                || !transformedSender.rolesIds
                || transformedSender.membershipExpiresAt === undefined
                || (transformedSender as any).membershipEndDate === undefined
                || partner1GalleryMissing
                || partner2GalleryMissing;

            if (needsPopulate && transformedSender.id) {
                try {
                    const mongooseCtr = new MongooseController(UserModel);
                    const senderPopulated = await mongooseCtr.findOne(
                        { id: transformedSender.id },
                        {
                            id: 1,
                            roles: 1,
                            rolesIds: 1,
                            ageVerify: 1,
                            membershipExpiresAt: 1,
                            membershipEndDate: 1,
                            partner1: 1,
                            partner2: 1,
                        } as any,
                        undefined,
                        [
                            { path: 'ageVerify' },
                            { path: 'roles' },
                            {
                                path: 'partner1',
                                populate: [{ path: 'gallery' }],
                            },
                            {
                                path: 'partner2',
                                populate: [{ path: 'gallery' }],
                            },
                        ],
                    );
                    if (senderPopulated.success && senderPopulated.result) {
                        // Merge ageVerify, roles, and galleries into sender
                        // Always use populated galleries if available, otherwise keep existing
                        // Prioritize populated data to ensure gallery.url is correctly populated
                        const populatedPartner1 = senderPopulated.result.partner1;
                        const populatedPartner2 = senderPopulated.result.partner2;

                        transformedSender = {
                            ...transformedSender,
                            ageVerify: senderPopulated.result.ageVerify || transformedSender.ageVerify,
                            roles: senderPopulated.result.roles || transformedSender.roles,
                            membershipEndDate: (senderPopulated.result as any).membershipEndDate || (transformedSender as any).membershipEndDate,
                            // Use populated partner if it has gallery with URL, otherwise keep existing
                            partner1: (populatedPartner1?.gallery?.url)
                                ? populatedPartner1
                                : (transformedSender.partner1?.gallery?.url
                                        ? transformedSender.partner1
                                        : populatedPartner1 || transformedSender.partner1),
                            partner2: (populatedPartner2?.gallery?.url)
                                ? populatedPartner2
                                : (transformedSender.partner2?.gallery?.url
                                        ? transformedSender.partner2
                                        : populatedPartner2 || transformedSender.partner2),
                        };
                    }
                }
                catch {
                    // If fetch fails, continue with existing sender data
                }
            }

            // Use hydrateUserMedia to apply proper blur/default image logic
            hydrateUserMedia(transformedSender, viewerMediaOptions);

            sender = transformedSender as typeof sender;
        }
        catch {
            // Non-fatal: if transformation fails, keep original sender
        }
    }

    const transformed = {
        ...plainMessage,
        ...(content ? { content } : {}),
        ...(sender ? { sender } : {}),
    } as unknown as I_Message;

    return transformed;
}

export async function transformMessageResult(context: I_Context, result: I_Return<I_Message>): Promise<I_Return<I_Message>> {
    if (!result.success || !result.result)
        return result;

    const transformed = await transformMessageMedia(context, result.result);
    return {
        ...result,
        result: transformed ?? result.result,
    };
}

export async function transformMessagesPagingResult(context: I_Context, result: I_Return<T_PaginateResult<I_Message>>): Promise<I_Return<T_PaginateResult<I_Message>>> {
    if (!result.success || !result.result)
        return result;

    const docs = await Promise.all(
        (result.result.docs || []).map(async message =>
            await transformMessageMedia(context, message) ?? message,
        ),
    );

    return {
        ...result,
        result: {
            ...result.result,
            docs,
        },
    };
}
