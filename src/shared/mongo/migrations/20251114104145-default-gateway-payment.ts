import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

// Narrow imports to avoid module index cycles
import type { I_PaymentGatewaySetting } from '#modules/payment/payment-gateway-setting/payment-gateway-setting.type.js';
import type { I_PaymentGateway } from '#modules/payment/payment-gateway/payment-gateway.type.js';

/**
 * Seed a disabled Netvalve payment gateway and placeholder settings.
 * Settings values are intentionally empty so we don't store secrets in source code.
 */
export async function up(db: C_Db) {
    const gatewayCtr = new MongoController<I_PaymentGateway>(db, 'paymentgateways');
    const settingCtr = new MongoController<I_PaymentGatewaySetting>(db, 'paymentgatewaysettings');

    const gateway = {
        code: 'netvalve',
        name: 'Netvalve',
        status: 'disabled',
    } as I_PaymentGateway;

    // Create gateway if it doesn't exist
    const filteredGateways = await mongo.getNewRecords(
        gatewayCtr,
        [gateway],
        (existing: I_PaymentGateway, next: I_PaymentGateway) => existing.code === next.code,
    );

    let gatewayId: string | undefined;

    if (filteredGateways.length > 0) {
        const created = await gatewayCtr.createOne(filteredGateways[0]! as any);
        if (!created.success) {
            return log.error('Failed to create Netvalve payment gateway.');
        }
        gatewayId = created.result.id;
        log.success('Netvalve payment gateway created.');
    }
    else {
        const existing = await gatewayCtr.findOne({ code: gateway.code });
        if (!existing.success) {
            return log.error('Failed to query existing payment gateway (netvalve).');
        }
        gatewayId = existing.result.id;
        log.info('Netvalve payment gateway already exists.');
    }

    if (!gatewayId) {
        return log.error('No payment gateway id available for Netvalve. Aborting settings seed.');
    }

    // Settings to seed (placeholders). Values intentionally empty.
    const settings = [
        { paymentGatewayId: gatewayId, key: 'baseUrl', name: 'Base URL', value: '' },
        { paymentGatewayId: gatewayId, key: 'clientId', name: 'Client ID', value: '' },
        { paymentGatewayId: gatewayId, key: 'apiKey', name: 'API Key', value: '' },
        { paymentGatewayId: gatewayId, key: 'siteId', name: 'Site ID', value: '' },
        { paymentGatewayId: gatewayId, key: 'midByCurrency', name: 'MID by currency (json)', value: '{}' },
    ] as I_PaymentGatewaySetting[];

    const filteredSettings = await mongo.getNewRecords(
        settingCtr,
        settings,
        (existing: I_PaymentGatewaySetting, next: I_PaymentGatewaySetting) =>
            existing.paymentGatewayId === next.paymentGatewayId && existing.key === next.key,
    );

    if (filteredSettings.length === 0) {
        log.info('No new Netvalve settings to create.');
        return;
    }

    for (const s of filteredSettings) {
        const created = await settingCtr.createOne(s as any);
        if (!created.success) {
            return log.error('Failed to create default Netvalve payment gateway setting.', created);
        }
    }

    log.success('Default Netvalve payment gateway settings created (values empty).');
}

export async function down(db: C_Db) {
    const gatewayCtr = new MongoController<I_PaymentGateway>(db, 'paymentgateways');
    const settingCtr = new MongoController<I_PaymentGatewaySetting>(db, 'paymentgatewaysettings');

    const existing = await gatewayCtr.findOne({ code: 'netvalve' });

    if (!existing.success || !existing.result) {
        log.info('No Netvalve payment gateway found to remove.');
        return;
    }

    const gatewayId = existing.result.id;

    // delete settings first
    const settingsDeleted = await settingCtr.deleteMany({ paymentGatewayId: gatewayId });
    if (!settingsDeleted.success) {
        return log.error('Failed to delete Netvalve payment gateway settings.');
    }

    // delete gateway
    const gatewayDeleted = await gatewayCtr.deleteOne({ id: gatewayId });
    if (!gatewayDeleted.success) {
        return log.error('Failed to delete Netvalve payment gateway.');
    }

    log.success('Netvalve payment gateway and its settings removed.');
}
