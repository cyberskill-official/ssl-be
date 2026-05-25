import type { NextFunction, Request, Response } from '@cyberskill/shared/node/express';
import type { Session, SessionData } from 'express-session';
import type { IncomingMessage } from 'node:http';

import type { I_SessionPayload } from '#modules/authn/authn.type.js';
import type { I_User } from '#modules/user/index.js';
import type { E_SessionPortal } from '#shared/session/index.js';

export interface I_Request extends Partial<Request> {
    sessionCookieName?: string;
    sessionPortal?: E_SessionPortal;
    session?: Session & Partial<SessionData> & {
        user?: I_User;
        guardianView?: {
            ownerId: string;
            issuedAt: number;
        };
    };
    body?: { fileName: string; query?: string; src?: string };
}

export interface I_Response extends Response { }

export interface I_NextFunction extends NextFunction { }

export interface I_Context {
    req?: I_Request;
}

export interface I_GuardianTokenPayload extends I_SessionPayload {
    guardian: true;
}

export interface I_IncomingMessage extends IncomingMessage {
    sessionCookieName?: string;
    sessionPortal?: E_SessionPortal;
    session?: Session & Partial<SessionData> & {
        user?: I_User;
    };
}
export interface I_WsContext {
    req?: I_IncomingMessage;
}
