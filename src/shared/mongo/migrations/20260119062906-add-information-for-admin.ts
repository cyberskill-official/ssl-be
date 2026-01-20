import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import { E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/authn.type.js';
import { E_Role_Staff } from '#modules/authz/role/role.type.js';

const ADMIN_EMAIL = 'admin@secretswingerlust.com';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = '123123';

export async function up(db: C_Db) {
    const rolesCollection = db.collection('roles');
    const usersCollection = db.collection('users');

    const adminRole = await rolesCollection.findOne({ name: E_Role_Staff.ADMIN });
    const adminRoleId = typeof adminRole?.['id'] === 'string' ? adminRole['id'] : undefined;

    if (!adminRoleId) {
        log.error('[Migration] ADMIN role not found or missing id. Aborting admin update.');
        return;
    }

    const existingAdmin = await usersCollection.findOne({ email: ADMIN_EMAIL });
    const now = new Date();

    if (!existingAdmin) {
        const insertResult = await usersCollection.insertOne({
            id: uuidv4(),
            username: DEFAULT_USERNAME,
            email: ADMIN_EMAIL,
            password: bcrypt.hashSync(DEFAULT_PASSWORD, 10),
            rolesIds: [adminRoleId],
            registerStep: E_RegisterStep.COMPLETE,
            isEmailVerified: true,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            isDel: false,
            ageVerify: { status: E_AgeVerifyStatus.APPROVED, approvedAt: now },
        });

        log.success(`[Migration] Created admin user (${insertResult.insertedId}).`);
        return;
    }

    const updateFields: Record<string, unknown> = {};

    if (!existingAdmin['username']) {
        updateFields['username'] = DEFAULT_USERNAME;
    }

    if (!existingAdmin['password']) {
        updateFields['password'] = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    }

    const rolesIds = Array.isArray(existingAdmin['rolesIds'])
        ? existingAdmin['rolesIds'].filter(Boolean)
        : [];

    if (!rolesIds.includes(adminRoleId)) {
        updateFields['rolesIds'] = [...rolesIds, adminRoleId];
    }

    if (!existingAdmin['registerStep'] || existingAdmin['registerStep'] !== E_RegisterStep.COMPLETE) {
        updateFields['registerStep'] = E_RegisterStep.COMPLETE;
    }

    if (existingAdmin['isEmailVerified'] !== true) {
        updateFields['isEmailVerified'] = true;
    }

    if (existingAdmin['isActive'] !== true) {
        updateFields['isActive'] = true;
    }

    const existingAgeVerify = existingAdmin['ageVerify'] as
        | { status?: E_AgeVerifyStatus; approvedAt?: Date }
        | undefined;

    if (existingAgeVerify?.status !== E_AgeVerifyStatus.APPROVED) {
        updateFields['ageVerify'] = { status: E_AgeVerifyStatus.APPROVED, approvedAt: now };
    }
    else if (!existingAgeVerify?.approvedAt) {
        updateFields['ageVerify'] = { ...existingAgeVerify, approvedAt: now };
    }

    if (Object.keys(updateFields).length === 0) {
        log.info('[Migration] Admin user already has required fields. No changes applied.');
        return;
    }

    updateFields['updatedAt'] = now;

    const updateResult = await usersCollection.updateOne(
        { _id: existingAdmin._id },
        { $set: updateFields },
    );

    if (!updateResult.acknowledged) {
        log.error('[Migration] Failed to update admin user.');
        return;
    }

    log.success('[Migration] Admin user updated with required fields.');
}

export async function down() {
    log.info('[Migration] No down migration for admin required fields update.');
}
