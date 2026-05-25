import { log } from '@cyberskill/shared/node/log';
import { addDays, addMinutes, addMonths } from 'date-fns';
import mongoose from 'mongoose';
import process from 'node:process';

import { E_AgeVerifyMethod, E_AgeVerifyStatus, E_RegisterStep } from '../modules/authn/authn.type.js';
import { RoleModel } from '../modules/authz/role/role.model.js';
import { E_Role, E_Role_User } from '../modules/authz/role/role.type.js';
import { UserModel } from '../modules/user/user.model.js';
import { E_AccountType, E_Gender, E_UserSettings_TimeFormat } from '../modules/user/user.type.js';
import { getEnv } from '../shared/env/index.js';
import { hashPassword, validate } from '../shared/util/index.js';

const DEFAULT_PASSWORD = 'Aa123123!';
const DEFAULT_EMAIL_DOMAIN = 'ssl.local.test';
const DEFAULT_DATE_OF_BIRTH = '1990-01-01';
const VALID_MEMBERSHIP_ROLES = Object.values(E_Role_User);
const VALID_REGISTER_STEPS = Object.values(E_RegisterStep);
const VALID_ACCOUNT_TYPES = Object.values(E_AccountType);
const VALID_GENDERS = Object.values(E_Gender);

function getArgValue(name: string): string | null {
    const prefix = `${name}=`;
    const inline = process.argv.find(arg => arg.startsWith(prefix));
    if (inline) {
        return inline.slice(prefix.length);
    }

    const index = process.argv.findIndex(arg => arg === name);
    if (index >= 0) {
        return process.argv[index + 1] ?? null;
    }

    return null;
}

function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

function requireArg(name: string): string {
    const value = getArgValue(name)?.trim();
    if (!value) {
        throw new Error(`Missing required argument: ${name}`);
    }
    return value;
}

function parseChoice<T extends string>(
    name: string,
    values: readonly T[],
    fallback: T,
): T {
    const rawValue = getArgValue(name)?.trim();
    if (!rawValue) {
        return fallback;
    }

    if (!values.includes(rawValue as T)) {
        throw new Error(`${name} must be one of: ${values.join(', ')}`);
    }

    return rawValue as T;
}

function parseDateArg(name: string): Date | null {
    const rawValue = getArgValue(name)?.trim();
    if (!rawValue) {
        return null;
    }

    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${name} must be a valid date or ISO datetime`);
    }

    return parsed;
}

function getMembershipRole(): E_Role_User {
    const shortcutCount = ['--free', '--paid', '--promo']
        .filter(flag => hasFlag(flag))
        .length;

    if (shortcutCount > 1) {
        throw new Error('Use only one of --free, --paid, or --promo');
    }

    if (hasFlag('--paid')) {
        return E_Role_User.PAID_MEMBER;
    }
    if (hasFlag('--promo')) {
        return E_Role_User.PROMO_MEMBER;
    }
    if (hasFlag('--free')) {
        return E_Role_User.FREE_MEMBER;
    }

    return parseChoice(
        '--membership-role',
        VALID_MEMBERSHIP_ROLES,
        E_Role_User.FREE_MEMBER,
    );
}

function calculateDefaultMembershipExpiry(now: Date): Date {
    const env = getEnv();

    if (env.MEMBERSHIP_EXTENSION_DAYS_OVERRIDE > 0) {
        return addDays(now, env.MEMBERSHIP_EXTENSION_DAYS_OVERRIDE);
    }
    if (env.MEMBERSHIP_EXTENSION_MINUTES_OVERRIDE > 0) {
        return addMinutes(now, env.MEMBERSHIP_EXTENSION_MINUTES_OVERRIDE);
    }

    return addMonths(now, 1);
}

async function resolveRoleIds(membershipRole: E_Role_User): Promise<string[]> {
    const roleNames = [E_Role.USER, membershipRole];
    const roles = await RoleModel.find({ name: { $in: roleNames } });
    const rolesByName = new Map(roles.map(role => [role.name, role.id]));
    const missingRoles = roleNames.filter(roleName => !rolesByName.get(roleName));

    if (missingRoles.length > 0) {
        throw new Error(`Missing role(s): ${missingRoles.join(', ')}. Run seed/ready before creating users.`);
    }

    return roleNames.map(roleName => rolesByName.get(roleName) as string);
}

function isAdultDateOfBirth(dateOfBirth: Date): boolean {
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = today.getMonth() - dateOfBirth.getMonth();
    const dayDiff = today.getDate() - dateOfBirth.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
        age--;
    }

    return age >= 18;
}

function printUsage(): void {
    log.info(`
Usage:
  pnpm tsx src/scripts/create-user.ts --username=<username> [options]

Required:
  --username=<username>

Options:
  --email=<email>                         Default: <username>@${DEFAULT_EMAIL_DOMAIN}
  --password=<password>                   Default: ${DEFAULT_PASSWORD}
  --membership-role=FREE_MEMBER|PAID_MEMBER|PROMO_MEMBER
  --free | --paid | --promo               Shortcut for --membership-role
  --membership-expires-at=<ISO datetime>  Optional expiry for paid/promo users
  --register-step=${VALID_REGISTER_STEPS.join('|')}  Default: COMPLETE
  --account-type=${VALID_ACCOUNT_TYPES.join('|')}      Default: SINGLE
  --gender=${VALID_GENDERS.join('|')}                   Optional partner1 gender
  --partner1-dob=<YYYY-MM-DD>             Optional partner1 date of birth
  --age-verified                          Mark age verification approved
  --unverified-email                      Default is verified
  --inactive                              Default is active
  --dry-run                               Resolve/validate data without writing DB

Examples:
  pnpm tsx src/scripts/create-user.ts --username=testuser1
  pnpm tsx src/scripts/create-user.ts --username=paiduser1 --paid
  pnpm tsx src/scripts/create-user.ts --username=demo1 --email=demo1@example.com --password='Aa123123!'
`);
}

async function run(): Promise<void> {
    if (hasFlag('--help') || hasFlag('-h')) {
        printUsage();
        return;
    }

    const env = getEnv();
    if (!env.MONGO_URI) {
        throw new Error('MONGO_URI is required to create a user');
    }

    const username = requireArg('--username');
    const email = (getArgValue('--email') ?? `${username}@${DEFAULT_EMAIL_DOMAIN}`).trim().toLowerCase();
    const passwordArg = getArgValue('--password');
    const password = passwordArg ?? DEFAULT_PASSWORD;
    const membershipRole = getMembershipRole();
    const registerStep = parseChoice('--register-step', VALID_REGISTER_STEPS, E_RegisterStep.COMPLETE);
    const accountType = parseChoice('--account-type', VALID_ACCOUNT_TYPES, E_AccountType.SINGLE);
    const partnerGender = getArgValue('--gender')
        ? parseChoice('--gender', VALID_GENDERS, E_Gender.FEMALE)
        : null;
    const partnerDob = parseDateArg('--partner1-dob')
        ?? (hasFlag('--age-verified') ? new Date(DEFAULT_DATE_OF_BIRTH) : null);
    const explicitMembershipExpiry = parseDateArg('--membership-expires-at');
    const now = new Date();
    const membershipExpiresAt = membershipRole === E_Role_User.FREE_MEMBER
        ? null
        : (explicitMembershipExpiry ?? calculateDefaultMembershipExpiry(now));

    validate.email.validate(email);
    validate.username.validate(username);
    validate.password.validate(password);

    if (partnerDob && !isAdultDateOfBirth(partnerDob)) {
        throw new Error('partner1 date of birth must be at least 18 years old');
    }

    log.info('Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    log.success('Connected to MongoDB');

    const adminBlockedUser = await UserModel.findOne({ email, isAdminBlocked: true });
    if (adminBlockedUser) {
        throw new Error('User is admin-blocked.');
    }

    const existingUser = await UserModel.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
        throw new Error(`User already exists: ${existingUser.username ?? existingUser.email}`);
    }

    const rolesIds = await resolveRoleIds(membershipRole);
    const settings = {
        timeFormat: E_UserSettings_TimeFormat.H24,
        notification: {
            followingPostAnnouncement: true,
            gainFollower: true,
            receiveMessage: true,
            newMemberJoined: true,
            sound: true,
        },
    };

    const partner1 = partnerGender || partnerDob
        ? {
                ...(partnerGender ? { gender: partnerGender } : {}),
                ...(partnerDob ? { dateOfBirth: partnerDob } : {}),
            }
        : undefined;

    const ageVerify = hasFlag('--age-verified') && partnerDob
        ? {
                status: E_AgeVerifyStatus.APPROVED,
                method: E_AgeVerifyMethod.OTHER,
                approvedAt: now,
                dateOfBirth: partnerDob,
                reason: 'Created by create-user script',
            }
        : undefined;

    const userPayload = {
        username,
        email,
        password: await hashPassword(password),
        rolesIds,
        registerStep,
        isActive: !hasFlag('--inactive'),
        isEmailVerified: !hasFlag('--unverified-email'),
        accountType,
        ...(partner1 ? { partner1 } : {}),
        ...(ageVerify ? { ageVerify } : {}),
        settings,
        ...(membershipExpiresAt ? { membershipExpiresAt } : {}),
        membershipCancelled: false,
    };

    const output = {
        username,
        email,
        password: passwordArg === null ? DEFAULT_PASSWORD : '[provided]',
        role: membershipRole,
        registerStep,
        isActive: userPayload.isActive,
        isEmailVerified: userPayload.isEmailVerified,
        accountType,
        membershipExpiresAt: membershipExpiresAt?.toISOString() ?? null,
        ageVerified: Boolean(ageVerify),
        dryRun: hasFlag('--dry-run'),
    };

    if (hasFlag('--dry-run')) {
        log.info('Dry run completed. No user was created.');
        log.info(JSON.stringify(output, null, 2));
        return;
    }

    const createdUser = await UserModel.create(userPayload);

    log.success('User created successfully');
    log.info(JSON.stringify({
        id: createdUser.id,
        ...output,
        dryRun: false,
    }, null, 2));
}

run()
    .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Create user failed: ${message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
            log.info('Disconnected from MongoDB');
        }
    });
