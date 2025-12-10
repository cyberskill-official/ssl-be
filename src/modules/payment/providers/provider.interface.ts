import type { I_Return } from '@cyberskill/shared/typescript';

import type { I_Context } from '#shared/typescript/index.js';

/**
 * Generic payment provider contract. Methods accept context and generic payloads
 * because each provider exposes different typed payloads. Return shape is
 * I_Return<unknown> to be flexible.
 */
export interface I_PaymentProvider {
    name: string;
    initialize?: (config?: Record<string, unknown>) => Promise<void> | void;
    sale?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    refund?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    createToken?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    initialize3ds?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    authenticate3ds?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    result3ds?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    capture?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    cancel?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    authorize?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    getTransaction?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    getTransactions?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    getOrder?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    getOrders?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    queryTransactionStatus?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
    rebill?: (context: I_Context, payload: Record<string, unknown>) => Promise<I_Return<unknown>>;
}

export type T_ProviderName = string;
