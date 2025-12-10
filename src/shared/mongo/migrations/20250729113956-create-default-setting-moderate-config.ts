import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Role } from '#modules/authz/index.js';
import type { I_Setting } from '#modules/setting/setting.type.js';

import { E_Role_Staff } from '#modules/authz/index.js';
import { E_SettingType } from '#modules/setting/index.js';

const moderateConfig = {
    type: E_SettingType.AI_MODERATION,
    value: {
        // Global thresholds - cân bằng giữa bảo mật và trải nghiệm người dùng
        autoRejectThreshold: 0.85, // Tự động từ chối khi confidence >= 85%
        humanReviewThreshold: 0.65, // Yêu cầu review khi confidence >= 65%

        // Image thresholds - ngưỡng cho từng loại nội dung hình ảnh
        imageThresholds: {
            explicitNudity: 0.75, // Nội dung khiêu dâm rõ ràng
            violence: 0.70, // Bạo lực
            hateSymbols: 0.80, // Biểu tượng thù địch
            drugs: 0.75, // Ma túy
            nonExplicitNudity: 0.85, // Nội dung khiêu dâm không rõ ràng
            swimwearOrUnderwear: 0.90, // Đồ bơi/đồ lót - cho phép với threshold cao
            fullNudity: 0.95, // Khoả thân hoàn toàn - chặn với threshold cao
        },
    },
};

export async function up(db: C_Db): Promise<void> {
    const settingCtr = new MongoController<I_Setting>(db, 'settings');
    const roleCtr = new MongoController<I_Role>(db, 'roles');
    const admin = await roleCtr.findOne({ name: E_Role_Staff.ADMIN });

    if (!admin.success) {
        return log.error('Admin role not found.');
    }

    const createdModerationConfig = await settingCtr.createOne(moderateConfig);

    if (!createdModerationConfig.success) {
        return log.error('Failed to create some default setting for AI moderation');
    }

    log.success(' Default AI moderation setting created successfully');
}

export async function down(db: C_Db): Promise<void> {
    const settingCtr = new MongoController<I_Setting>(db, 'settings');

    const deleted = await settingCtr.deleteOne({ type: E_SettingType.AI_MODERATION });

    if (!deleted.success) {
        return log.error('Failed to delete AI moderation setting.');
    }

    log.success('AI moderation setting deleted successfully.');
}
