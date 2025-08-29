import type { NextFunction, Request, Response } from '@cyberskill/shared/node/express';
import type { Session, SessionData } from 'express-session';

import type { I_User } from '#modules/user/index.js';

export interface I_Request extends Partial<Request> {
    session?: Session & Partial<SessionData> & {
        user?: I_User;
        meta?: {
            loginIp?: string;
        };
    };
    body?: { fileName: string; query?: string; src?: string };
}

export interface I_Response extends Response { }

export interface I_NextFunction extends NextFunction { }

export interface I_Context {
    req?: I_Request;
}
