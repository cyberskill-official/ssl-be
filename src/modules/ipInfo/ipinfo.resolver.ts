import { ipInfoCtr } from './ipinfo.controller.js';

const ipInfoResolver = {
    Query: {
        getIpInfo: (_parent: unknown, args: { ip: string }) => ipInfoCtr.getIpInfo(args.ip),
        getMyIp: () => ipInfoCtr.getMyIp(),
    },
};

export default ipInfoResolver;
