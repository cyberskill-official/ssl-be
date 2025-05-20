import { substringBetween } from '@cyberskill/shared/util';
import { CronJob } from 'cron';

import { getEnv } from '#modules/env/index.js';
import { mongoBackup } from '#modules/mongo/index.js';

import { CRON_JOB_SCHEDULE_DEFAULT } from './cron.constant.js';

const env = getEnv();

const cron = {
    start: () => {
        cron.backupDB().start();
    },
    backupDB: () => {
        return new CronJob(CRON_JOB_SCHEDULE_DEFAULT, async () => {
            mongoBackup.backup();

            const currentList = await mongoBackup.getList();

            if (!currentList?.success) {
                return;
            }

            if (currentList?.result?.length === 30) {
                const oldest = currentList.result.reduce((oldestFile, currentFile) => {
                    const currentDate = new Date(substringBetween(currentFile, `${env.MONGO_NAME}-`, '.gz'));
                    const oldestDate = new Date(substringBetween(oldestFile, `${env.MONGO_NAME}-`, '.gz'));

                    return currentDate < oldestDate ? currentFile : oldestFile;
                });

                mongoBackup.delete({ body: { fileName: oldest } });
            }
        });
    },
};

export { cron };
