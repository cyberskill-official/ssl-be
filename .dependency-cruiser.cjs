/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'baseline-no-circular',
            severity: 'warn',
            from: {},
            to: { circular: true },
        },
        {
            name: 'menu-pilot-no-circular',
            severity: 'error',
            from: { path: '^src/modules/menu/' },
            to: { circular: true },
        },
        {
            name: 'menu-pilot-no-controller-import',
            severity: 'error',
            from: { path: '^src/modules/menu/(?!menu\\.controller\\.ts$)' },
            to: { path: '^src/modules/menu/menu\\.controller\\.ts$' },
        },
        {
            name: 'menu-pilot-no-module-barrel',
            severity: 'error',
            from: { path: '^src/modules/' },
            to: { path: '^src/modules/menu/index\\.ts$' },
        },
        {
            name: 'menu-pilot-resolver-only-uses-service',
            severity: 'error',
            from: { path: '^src/modules/menu/menu\\.resolver\\.ts$' },
            to: { path: '^src/modules/menu/menu\\.(repository|model)\\.ts$' },
        },
        {
            name: 'menu-pilot-service-uses-repository-not-model',
            severity: 'error',
            from: { path: '^src/modules/menu/menu\\.service\\.ts$' },
            to: { path: '^src/modules/menu/menu\\.model\\.ts$' },
        },
        {
            name: 'menu-pilot-repository-does-not-use-service',
            severity: 'error',
            from: { path: '^src/modules/menu/menu\\.repository\\.ts$' },
            to: { path: '^src/modules/menu/menu\\.service\\.ts$' },
        },
    ],
    options: {
        doNotFollow: {
            path: 'node_modules',
        },
        exclude: {
            path: [
                '^build/',
                '^dist/',
                '^src/shared/graphql/generated/',
                '^src/shared/mongo/migrations/data/',
            ].join('|'),
        },
        tsConfig: {
            fileName: 'tsconfig.json',
        },
        tsPreCompilationDeps: true,
    },
};
