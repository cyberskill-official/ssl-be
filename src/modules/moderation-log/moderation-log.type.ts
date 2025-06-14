import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

export enum E_Action {
    DELETE = 'DELETE',
    SUSPEND = 'SUSPEND',
    APPROVE = 'APPROVE',
    WARN = 'WARN',
    DEACTIVE = 'DEACTIVE',
    CLOSE = 'CLOSE',
}

export interface I_ModerationLog_PayLoad {
    triggeredById?: string;
    triggeredBy?: I_User;
    action?: E_Action;
    targetId?: string;
    target?: I_User;
    comment?: string;
}

export interface I_ModerationLog extends I_ModerationLog_PayLoad, I_GenericDocument { }

export interface I_Input_QueryModerationLog extends I_ModerationLog { }

export interface I_Input_MutateModerationLog extends Omit<I_ModerationLog, 'id' | 'createdAt' | 'updatedAt' | 'triggeredBy' | 'target'> { }
