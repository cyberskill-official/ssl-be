import type { I_Context } from '#shared/typescript/index.js';

import { ipInfoCtr } from './ipinfo.controller.js';

const ipInfoResolver = {
    Query: {
        getIp: (_parent: unknown, _args: unknown, context: I_Context) => ipInfoCtr.getIp(context),
        getIpInfo: (_parent: unknown, args: { ip: string }) => ipInfoCtr.getIpInfo(args.ip),
        getMyIp: () => ipInfoCtr.getMyIp(),
    },
};

export default ipInfoResolver;
