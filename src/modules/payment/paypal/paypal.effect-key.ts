interface I_PayPalPaymentKeyInput {
    subscriptionId?: string | null;
    occurredAt?: string | Date | null;
    amount?: string | number | null;
    currency?: string | null;
    transactionId?: string | null;
}

function normalizeDay(value: string | Date | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeAmount(value: string | number | null | undefined): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toFixed(2);
    }

    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed.toFixed(2) : value.trim();
    }

    return 'unknown-amount';
}

function normalizeCurrency(value: string | null | undefined): string {
    return typeof value === 'string' && value.trim()
        ? value.trim().toUpperCase()
        : 'unknown-currency';
}

export function buildPayPalSubscriptionPaymentEffectKey(input: I_PayPalPaymentKeyInput): string | null {
    const subscriptionId = input.subscriptionId?.trim();
    if (!subscriptionId) {
        return null;
    }

    const paymentDay = normalizeDay(input.occurredAt);
    if (paymentDay) {
        return [
            'paypal',
            'subscription',
            subscriptionId,
            'payment',
            paymentDay,
            normalizeAmount(input.amount),
            normalizeCurrency(input.currency),
        ].join(':');
    }

    const transactionId = input.transactionId?.trim();
    if (transactionId) {
        return ['paypal', 'subscription', subscriptionId, 'transaction', transactionId].join(':');
    }

    return null;
}

export function getPayPalSubscriptionLastPayment(subscription: Record<string, any> | null | undefined): {
    time: string | null;
    amount: string | number | null;
    currency: string | null;
} {
    const lastPayment = subscription?.['billing_info']?.['last_payment'];
    const amount = lastPayment?.['amount'];

    return {
        time: typeof lastPayment?.['time'] === 'string' ? lastPayment.time : null,
        amount: typeof amount?.['value'] === 'string' || typeof amount?.['value'] === 'number'
            ? amount.value
            : null,
        currency: typeof amount?.['currency_code'] === 'string' ? amount.currency_code : null,
    };
}
