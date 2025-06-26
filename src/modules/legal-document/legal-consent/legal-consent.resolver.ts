import type { I_Context } from '#shared/typescript/index.js';
import type { I_Input_CreateLegalConsent } from './legal-consent.type.js';
import { legalConsentCtr } from './legal-consent.controller.js';

const legalConsentResolver = {
    Query: {
        checkLegalConsents: (_parent: unknown, _args: unknown, context: I_Context) => legalConsentCtr.checkLegalConsents(context),
    },
    Mutation: {
        createLegalConsent: (_parent: unknown, args: { doc: I_Input_CreateLegalConsent }, context: I_Context) => legalConsentCtr.createLegalConsent(context, args),
    },
};

export default legalConsentResolver; 