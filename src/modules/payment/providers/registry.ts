import type { I_PaymentProvider, T_ProviderName } from './provider.interface.js';

const providers = new Map<T_ProviderName, I_PaymentProvider>();

export function registerProvider(name: T_ProviderName, provider: I_PaymentProvider) {
    if (providers.has(name)) {
        // override intentionally allowed
    }
    providers.set(name, provider);
}

export function getProvider(name: T_ProviderName): I_PaymentProvider | undefined {
    return providers.get(name);
}

export function listProviders(): I_PaymentProvider[] {
    return [...providers.values()];
}
