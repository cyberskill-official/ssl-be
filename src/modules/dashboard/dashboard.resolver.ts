import type { I_Context } from '#shared/typescript/index.js';

import { dashboardCtr } from './dashboard.controller.js';

const dashboardResolver = {
    Query: {
        getDashboardReport: () => dashboardCtr.getDashboardReport(),
        getAdminPendingCounts: (_parent: unknown, args: { refresh?: boolean }, context: I_Context) =>
            dashboardCtr.getAdminPendingCounts(context, args),
    },
};

export default dashboardResolver;
