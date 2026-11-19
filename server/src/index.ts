import { createApp } from './app.js';

const instance = createApp();
const { app, config } = instance;

const server = app.listen(config.port, () => {
  console.log(`MONO API listening on http://localhost:${config.port}`);
  console.log(`Founder exclusive blue tick: @${config.founderUsername}`);
  console.log('Policy: No Reels | Private Follower/Following Lists | 30-Day Message Auto-Erasure');
});

function shutdown() {
  server.close(() => {
    instance.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
