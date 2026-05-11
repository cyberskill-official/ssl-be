import { mergeConfigs } from '@cyberskill/shared/config';

export default mergeConfigs('eslint', {
    ignores: ['src/shared/mongo/migrations/data/*.json', 'bootstrap.js'],
});
