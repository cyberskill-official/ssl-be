import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';
import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryMembershipEntitlementChange } from './membership-entitlement-change.type.js';

import { membershipEntitlementChangeCtr } from './membership-entitlement-change.controller.js';

export default {
    Query: {
        getMembershipEntitlementChange: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryMembershipEntitlementChange>, context: I_Context) => membershipEntitlementChangeCtr.getMembershipEntitlementChange(context, args),
        getMembershipEntitlementChanges: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryMembershipEntitlementChange>, context: I_Context) => membershipEntitlementChangeCtr.getMembershipEntitlementChanges(context, args),
    },
};
