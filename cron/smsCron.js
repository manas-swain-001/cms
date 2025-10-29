const cron = require('node-cron');
const axios = require('axios');
const { Task } = require('../models/Task');

class SMSCronJob {
  constructor() {
    this.baseUrl = process.env.API_BASE_URL || 'http://localhost:5000';
    this.testMode = process.env.CRON_TEST_MODE === 'true' || true; // Force test mode
    this.isRunning = false;
  }

  /**
   * Call SMS API with test data
   */
  async callSMSAPI() {
    try {
      console.log('Cron job triggered at:', new Date().toLocaleString());
      return 0;
    } catch (error) {
      console.error('SMS API Error:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update task statuses based on time (warning and escalation logic)
   */
  async updateTaskStatuses() {
    try {
      console.log('🔄 Updating task statuses at:', new Date().toLocaleString());
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Get all tasks for today
      const tasks = await Task.find({ date: today });
      
      let updatedCount = 0;
      
      for (const task of tasks) {
        let taskUpdated = false;
        
        for (const entry of task.scheduledEntries) {
          if (entry.status === 'pending') {
            const scheduledTime = entry.scheduledTime;
            const [scheduledHour, scheduledMinute] = scheduledTime.split(':').map(Number);
            const scheduledDateTime = new Date(today);
            scheduledDateTime.setHours(scheduledHour, scheduledMinute, 0, 0);
            
            const now = new Date();
            const timeDiff = now - scheduledDateTime;
            const minutesPastScheduled = Math.floor(timeDiff / (1000 * 60));
            
            // 10 minutes past scheduled time - send warning
            if (minutesPastScheduled >= 10 && minutesPastScheduled < 20) {
              entry.status = 'warning_sent';
              taskUpdated = true;
              console.log(`⚠️ Warning sent for user ${task.userId} at ${scheduledTime}`);
            }
            // 20 minutes past scheduled time - escalate
            else if (minutesPastScheduled >= 20) {
              entry.status = 'escalated';
              taskUpdated = true;
              console.log(`🚨 Escalated for user ${task.userId} at ${scheduledTime}`);
            }
          }
        }
        
        if (taskUpdated) {
          await task.save();
          updatedCount++;
        }
      }
      
      console.log(`✅ Updated ${updatedCount} tasks with status changes`);
      return { success: true, updatedCount };
      
    } catch (error) {
      console.error('❌ Task status update error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start the cron jobs
   */
  start() {
    if (this.isRunning) {
      console.log('Cron jobs are already running');
      return;
    }

    console.log('Starting SMS Cron Jobs...');
    this.isRunning = true;

    if (this.testMode) {
      // Test mode - run every 10 seconds
      console.log('TEST MODE: Running every 10 seconds');
      cron.schedule('*/10 * * * * *', () => {
        this.callSMSAPI();
        this.updateTaskStatuses();
      });
    } else {
      // Production mode - run at specified times
      console.log('PRODUCTION MODE: Running at scheduled times');
      
      // 10:30 AM
      cron.schedule('30 10 * * *', () => {
        console.log('10:30 AM - Calling SMS API');
        this.callSMSAPI();
      });

      // 12:00 PM (noon)
      cron.schedule('0 12 * * *', () => {
        console.log('12:00 PM - Calling SMS API');
        this.callSMSAPI();
      });

      // 1:30 PM
      cron.schedule('30 13 * * *', () => {
        console.log('1:30 PM - Calling SMS API');
        this.callSMSAPI();
      });

      // 4:00 PM
      cron.schedule('0 16 * * *', () => {
        console.log('4:00 PM - Calling SMS API');
        this.callSMSAPI();
      });

      // 5:30 PM
      cron.schedule('30 17 * * *', () => {
        console.log('5:30 PM - Calling SMS API');
        this.callSMSAPI();
      });

      // Task status update - run every minute
      cron.schedule('* * * * *', () => {
        this.updateTaskStatuses();
      });
    }

    console.log('SMS Cron Jobs started successfully');
  }

  /**
   * Stop the cron jobs
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Cron jobs are not running');
      return;
    }

    console.log('🛑 Stopping SMS Cron Jobs...');
    cron.getTasks().forEach(task => task.destroy());
    this.isRunning = false;
    console.log('✅ SMS Cron Jobs stopped');
  }

  /**
   * Get cron job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      testMode: this.testMode,
      baseUrl: this.baseUrl,
      activeJobs: cron.getTasks().length
    };
  }
}

// Create singleton instance
const smsCronJob = new SMSCronJob();

module.exports = smsCronJob;
