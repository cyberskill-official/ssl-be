import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Menu } from '#modules/menu/index.js';

export async function up(db: C_Db) {
    const menuCtr = new MongoController<I_Menu>(db, 'menus');

    // tìm tất cả menu có url '/resort'
    const found = await menuCtr.findAll({ url: '/resort' });

    if (!found.success) {
        log.error('Failed to query menus with url "/resort". Migration aborted.');
        return;
    }

    if (!found.result || found.result.length === 0) {
        log.info('No menus with url "/resort" found. Nothing to update.');
        return;
    }

    let updatedCount = 0;
    for (const m of found.result) {
        const res = await menuCtr.updateOne({ id: m.id }, { url: '/destination' });
        if (!res.success) {
            log.error(`Failed to update menu id=${m.id} url from "/resort" to "/destination".`);
            continue;
        }
        updatedCount++;
        log.info(`Updated menu id=${m.id} url "/resort" -> "/destination".`);
    }

    log.success(`Migration up: updated ${updatedCount} menu(s) from "/resort" to "/destination".`);
}

export async function down(db: C_Db) {
    const menuCtr = new MongoController<I_Menu>(db, 'menus');

    // revert: tất cả menu có url '/destination' chuyển về '/resort'
    const found = await menuCtr.findAll({ url: '/destination' });

    if (!found.success) {
        log.error('Failed to query menus with url "/destination". Rollback aborted.');
        return;
    }

    if (!found.result || found.result.length === 0) {
        log.info('No menus with url "/destination" found. Nothing to revert.');
        return;
    }

    let revertedCount = 0;
    for (const m of found.result) {
        const res = await menuCtr.updateOne({ id: m.id }, { url: '/resort' });
        if (!res.success) {
            log.error(`Failed to revert menu id=${m.id} url from "/destination" to "/resort".`);
            continue;
        }
        revertedCount++;
        log.info(`Reverted menu id=${m.id} url "/destination" -> "/resort".`);
    }

    log.success(`Migration down: reverted ${revertedCount} menu(s) from "/destination" to "/resort".`);
}
