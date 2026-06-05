/* eslint-disable node/prefer-global/process */
import 'dotenv/config';
import mongoose from 'mongoose';

import { translationQueue } from '../modules/translation/translation.queue.js';
import { getEnv } from '../shared/env/index.js';

const [type, id] = process.argv.slice(2);

if (!type || !id || !['blog', 'destination'].includes(type)) {
    console.error('Usage: npx tsx scripts/retranslate.ts <blog|destination> <id>');
    process.exit(1);
}

const translationId = id!;
const translationType = type as 'blog' | 'destination';

async function main() {
    const env = getEnv();
    const uri = env['MONGO_URI'] || 'mongodb://localhost:27017/ssl-be';
    console.log(`Connecting to ${uri} ...`);
    await mongoose.connect(uri);

    console.log(`Enqueuing translation for ${translationType} ${translationId} ...`);
    await translationQueue.add({ type: translationType, id: translationId });
    console.log(`Done. Translation job for ${translationType} ${translationId} enqueued.`);

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
