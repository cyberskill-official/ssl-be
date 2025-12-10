import { netvalveCtr } from '#modules/payment/netvalve/netvalve.controller.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';

import type { I_PaymentProvider } from './provider.interface.js';

import { registerProvider } from './registry.js';

// Adapter that exposes netvalveCtr methods through the generic provider contract.
// Use a cast to I_PaymentProvider to avoid exact payload typing differences between
// provider-specific method signatures and the generic contract.
const netvalveAdapter = {
    name: E_PaymentProvider.NETVALVE,
    initialize3ds: netvalveCtr.initialize3ds,
    authenticate3ds: netvalveCtr.authenticate3ds,
    result3ds: netvalveCtr.result3ds,
    sale: netvalveCtr.sale,
    refund: netvalveCtr.refund,
    rebill: netvalveCtr.rebill,
    createToken: netvalveCtr.createToken,
    capture: netvalveCtr.capture,
    cancel: netvalveCtr.cancel,
    authorize: netvalveCtr.authorize,
    getTransaction: netvalveCtr.getTransaction,
    getTransactions: netvalveCtr.getTransactions,
    getOrder: netvalveCtr.getOrder,
    getOrders: netvalveCtr.getOrders,
    queryTransactionStatus: netvalveCtr.queryTransactionStatus,
} as unknown as I_PaymentProvider;

// Register immediately so imports cause provider to be available.
registerProvider(E_PaymentProvider.NETVALVE, netvalveAdapter);

export default netvalveAdapter;
