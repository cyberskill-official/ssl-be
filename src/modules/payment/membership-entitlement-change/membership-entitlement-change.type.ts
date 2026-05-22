import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_PaymentProvider } from '../payment-transaction/payment-transaction.type.js';

export enum E_MembershipEntitlementChangeSource {
    PAYMENT_EFFECT = 'PAYMENT_EFFECT',
    WEBHOOK = 'WEBHOOK',
    STATUS_POLL = 'STATUS_POLL',
    RECONCILIATION = 'RECONCILIATION',
    CRON = 'CRON',
    ADMIN_SYNC = 'ADMIN_SYNC',
}

export enum E_MembershipEntitlementChangeReason {
    INITIAL_PAYMENT = 'INITIAL_PAYMENT',
    RENEWAL_PAYMENT = 'RENEWAL_PAYMENT',
    TOP_UP_REPLACEMENT = 'TOP_UP_REPLACEMENT',
    LEGACY_PAYMENT = 'LEGACY_PAYMENT',
    DOWNGRADE_EXPIRED = 'DOWNGRADE_EXPIRED',
    CANCELLED_EXPIRED = 'CANCELLED_EXPIRED',
    RENEWAL_DELAY_HOLD = 'RENEWAL_DELAY_HOLD',
    MANUAL_REPAIR = 'MANUAL_REPAIR',
}

export interface I_MembershipEntitlementChange extends I_GenericDocument {
    userId: string;
    orderId?: string;
    paymentRequestId?: string;
    provider?: E_PaymentProvider;
    providerSubscriptionId?: string;
    transactionId?: string;
    effectKey?: string;
    source: E_MembershipEntitlementChangeSource;
    reason: E_MembershipEntitlementChangeReason;
    beforeMembershipExpiresAt?: Date;
    afterMembershipExpiresAt?: Date;
    beforeRolesIds?: string[];
    afterRolesIds?: string[];
    beforeMembershipCancelled?: boolean;
    afterMembershipCancelled?: boolean;
    changedAt: Date;
    metadata?: Record<string, unknown>;
}

export interface I_Input_QueryMembershipEntitlementChange extends Partial<I_MembershipEntitlementChange> {
}

export interface I_Input_CreateMembershipEntitlementChange extends Omit<I_MembershipEntitlementChange, T_Omit_Create> {
}

export interface I_Input_UpdateMembershipEntitlementChange extends Partial<Omit<I_MembershipEntitlementChange, T_Omit_Update>> {
}
