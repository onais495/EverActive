require('dotenv').config();
const app = require('./app');
const { startEventSyncJob } = require('./jobs/eventSyncJob');
const { startNudgeJob } = require('./jobs/nudgeJob');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

startEventSyncJob();
startNudgeJob();
