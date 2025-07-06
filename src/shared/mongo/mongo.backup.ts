import { lstatSync, mkdirSync, pathExistsSync, readdirSync, removeSync, unlinkSync } from '@cyberskill/shared/node/fs';
import { spawn } from 'node:child_process';

import type { I_Request, I_Response } from '#shared/typescript/index.js';

import { getEnv } from '#shared/env/index.js';

const env = getEnv();

export const mongoBackup = {
    getList: async (_req?: I_Request, res?: I_Response) => {
        try {
            const list: string[] = [];

            readdirSync(env.MONGO_BACKUP_FOLDER).forEach(file =>
                list.push(file),
            );

            const response = {
                success: true,
                result: list,
            };

            if (!res) {
                return response;
            }

            res.json(response);
        }
        catch (err) {
            const response = {
                success: false,
                result: null,
                message: (err as Error).message,
            };

            if (!res) {
                return response;
            }

            res.status(500).send(response);
        }
    },
    download: async (req?: I_Request, res?: I_Response) => {
        try {
            const fileName = req?.body?.fileName;
            const file = `${env.MONGO_BACKUP_FOLDER}/${fileName}`;

            if (lstatSync(file).isDirectory()) {
                const response = {
                    success: false,
                    result: null,
                    message: 'Cannot download folder',
                };

                if (!res) {
                    return response;
                }

                res.status(500).send(response);
            }

            if (!res) {
                return {
                    success: true,
                    result: file,
                };
            }

            res.download(file);
        }
        catch (err) {
            const response = {
                success: false,
                result: null,
                message: (err as Error).message,
            };

            if (!res) {
                return response;
            }

            res.status(500).send(response);
        }
    },
    backup: async (_req?: I_Request, res?: I_Response) => {
        try {
            if (!pathExistsSync(env.MONGO_BACKUP_FOLDER)) {
                mkdirSync(env.MONGO_BACKUP_FOLDER, { recursive: true });
            }

            const fileName = `${env.MONGO_NAME}-${new Date().toJSON()}.gz`;
            const fullPath = `${env.MONGO_BACKUP_FOLDER}/${fileName}`;

            const mongoConfig: string[] = [];

            mongoConfig.push(`--db=${env.MONGO_NAME}`);

            mongoConfig.push(`--archive=./${fullPath}`);

            mongoConfig.push('--gzip');

            const backupProcess = spawn('mongodump', mongoConfig);

            backupProcess.on('error', (err) => {
                const response = { success: false, result: null, message: err };

                if (!res) {
                    return response;
                }

                res.status(500).send(response);
            });

            backupProcess.on('exit', (code, signal) => {
                if (code) {
                    const response = {
                        success: false,
                        result: null,
                        message: `Backup process exited with code ${code}`,
                    };

                    if (!res) {
                        return response;
                    }

                    res.status(500).send(response);
                }
                else if (signal) {
                    const response = {
                        success: false,
                        result: null,
                        message: `Backup process was killed with signal ${signal}`,
                    };

                    if (!res) {
                        return response;
                    }

                    res.status(500).send(response);
                }
                else {
                    const response = {
                        success: true,
                        result: null,
                        message: 'Backup completed successfully',
                    };

                    if (!res) {
                        return response;
                    }

                    res.json(response);
                }
            });
        }
        catch (err) {
            const response = {
                success: false,
                result: null,
                message: (err as Error).message,
            };

            if (!res) {
                return response;
            }

            res.status(500).send(response);
        }
    },
    restore: async (req?: I_Request, res?: I_Response) => {
        try {
            const fileName = req?.body?.fileName;
            const restoreProcess = spawn('mongorestore', [
                '--gzip',
                `--archive=./${env.MONGO_BACKUP_FOLDER}/${fileName}`,
            ]);

            restoreProcess.on('exit', (code, signal) => {
                if (code) {
                    const response = {
                        success: false,
                        result: null,
                        message: `Restore process exited with code ${code}`,
                    };

                    if (!res) {
                        return response;
                    }

                    res.status(500).send(response);
                }
                else if (signal) {
                    const response = {
                        success: false,
                        result: null,
                        message: `Restore process was killed with signal ${signal}`,
                    };

                    if (!res) {
                        return response;
                    }

                    res.status(500).send(response);
                }
                else {
                    const response = {
                        success: true,
                        result: null,
                    };

                    if (!res) {
                        return response;
                    }

                    return res.json(response);
                }
            });
        }
        catch (err) {
            const response = {
                success: false,
                result: null,
                message: (err as Error).message,
            };

            if (!res) {
                return response;
            }

            res.status(500).send(response);
        }
    },
    delete: async (req?: I_Request, res?: I_Response) => {
        try {
            const fileName = req?.body?.fileName;
            const removeItem = `${env.MONGO_BACKUP_FOLDER}/${fileName}`;

            if (lstatSync(removeItem).isDirectory()) {
                removeSync(removeItem);

                const response = {
                    success: true,
                    result: null,
                };

                if (!res) {
                    return response;
                }

                res.json(response);
            }

            unlinkSync(removeItem);

            const response = {
                success: true,
                result: null,
            };

            if (!res) {
                return response;
            }

            res.json(response);
        }
        catch (err) {
            const response = {
                success: false,
                result: null,
                message: (err as Error).message,
            };

            if (!res) {
                return response;
            }

            res.status(500).send(response);
        }
    },
};
