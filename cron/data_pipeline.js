const cron = require('node-cron');
const { callRefreshToken } = require('../datapipeline');

class DataPipeline {
  constructor() {
    this.jobs = [];
    this.isTestMode = false; // change to true for testing (runs every 20 seconds)
  }

  /**
   * Schedule DataPipeline job
   * - Test Mode: every 20 seconds
   * - Production Mode: every day at 11:00 PM IST
   */
  startDataPipelineJob() {
    // const scheduleTime = this.isTestMode ? '*/20 * * * * *' : '0 23 * * *';
    const scheduleTime = this.isTestMode ? '*/20 * * * * *' : '0 40 13 * * *';
    const mode = this.isTestMode
      ? 'TEST MODE (every 20 seconds)'
      : 'PRODUCTION MODE (every day at 11:00 PM IST)';

    const job = cron.schedule(
      scheduleTime,
      async () => {
        console.log(
          `[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] DataPipeline job running...`
        );
        await this.runPipeline();
      },
      {
        scheduled: true,
        timezone: 'Asia/Kolkata',
      }
    );

    this.jobs.push(job);
    console.log(`DataPipeline job scheduled: ${mode}`);
  }

  /**
   * Main DataPipeline process
   */
  async runPipeline() {
    try {
      await callRefreshToken();
      console.log('DataPipeline job executed successfully.');
    } catch (error) {
      console.error('DataPipeline job failed:', error.message);
    }
  }

  /**
   * Start all scheduled jobs
   */
  start() {
    this.startDataPipelineJob();
  }

  /**
   * Stop all jobs
   */
  stop() {
    this.jobs.forEach(job => job.stop());
    console.log('All DataPipeline jobs stopped.');
  }
}

module.exports = new DataPipeline();