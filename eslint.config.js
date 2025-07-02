import { mergeConfigs } from '@cyberskill/shared/config';

export default mergeConfigs('eslint', {
    ignores: ['src/modules/mongo/migrations/location/*.json'],
});
