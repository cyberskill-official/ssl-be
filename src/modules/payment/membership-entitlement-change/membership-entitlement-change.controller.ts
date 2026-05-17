import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { MembershipEntitlementChangeModel } from './membership-entitlement-change.model.js';
import type {
    I_Input_CreateMembershipEntitlementChange,
    I_Input_QueryMembershipEntitlementChange,
    I_MembershipEntitlementChange,
} from './membership-entitlement-change.type.js';

const membershipEntitlementChangeMongooseCtr = new MongooseController<I_MembershipEntitlementChange>(MembershipEntitlementChangeModel);

export const membershipEntitlementChangeCtr = {
    getMembershipEntitlementChange(_context: I_Context, args: I_Input_FindOne<I_Input_QueryMembershipEntitlementChange>) {
        return membershipEntitlementChangeMongooseCtr.findOne(args.filter as any, args.projection, args.options, args.populate);
    },

    getMembershipEntitlementChanges(_context: I_Context, args: I_Input_FindPaging<I_Input_QueryMembershipEntitlementChange>) {
        return membershipEntitlementChangeMongooseCtr.findPaging((args.filter ?? {}) as any, args.options);
    },

    recordMembershipEntitlementChange(_context: I_Context, args: {
        doc: I_Input_CreateMembershipEntitlementChange;
    }) {
        return MembershipEntitlementChangeModel.create(args.doc);
    },
};

export default membershipEntitlementChangeCtr;
