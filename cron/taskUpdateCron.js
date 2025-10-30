const cron = require('node-cron');
const Task = require('../models/Task');

class TaskUpdateCron {
  constructor() {
    this.jobs = [];
  }

  /**
   * Set 1: Check for pending updates (5 minutes before deadline)
   * Just console log the user IDs who haven't updated yet
   */
  startReminderChecks() {
    // 10:25 AM - Check 10:30 slot
    const job1 = cron.schedule('25 10 * * *', async () => {
      console.log('⏰ [Set 1] Running check at 10:25 AM for 10:30 slot...');
      await this.checkPendingUpdates('10:30');
    });

    // 11:55 AM - Check 12:00 slot
    const job2 = cron.schedule('55 11 * * *', async () => {
      console.log('⏰ [Set 1] Running check at 11:55 AM for 12:00 slot...');
      await this.checkPendingUpdates('12:00');
    });

    // 01:25 PM - Check 13:30 slot
    const job3 = cron.schedule('25 13 * * *', async () => {
      console.log('⏰ [Set 1] Running check at 01:25 PM for 13:30 slot...');
      await this.checkPendingUpdates('13:30');
    });

    // 03:55 PM - Check 16:00 slot
    const job4 = cron.schedule('55 15 * * *', async () => {
      console.log('⏰ [Set 1] Running check at 03:55 PM for 16:00 slot...');
      await this.checkPendingUpdates('16:00');
    });

    // 05:25 PM - Check 17:30 slot
    const job5 = cron.schedule('25 17 * * *', async () => {
      console.log('⏰ [Set 1] Running check at 05:25 PM for 17:30 slot...');
      await this.checkPendingUpdates('17:30');
    });

    this.jobs.push(job1, job2, job3, job4, job5);
    console.log('✅ Task Update Reminder Checks (Set 1) scheduled');
  }

  /**
   * Set 2: Send warnings (10 minutes after deadline)
   * Mark status as 'warning_sent' for users who haven't updated
   */
  startWarningChecks() {
    // 10:40 AM - Warn for 10:30 slot
    const job1 = cron.schedule('40 10 * * *', async () => {
      console.log('⚠️ [Set 2] Running warning check at 10:40 AM for 10:30 slot...');
      await this.sendWarnings('10:30');
    });

    // 12:10 PM - Warn for 12:00 slot
    const job2 = cron.schedule('10 12 * * *', async () => {
      console.log('⚠️ [Set 2] Running warning check at 12:10 PM for 12:00 slot...');
      await this.sendWarnings('12:00');
    });

    // 01:40 PM - Warn for 13:30 slot
    const job3 = cron.schedule('40 13 * * *', async () => {
      console.log('⚠️ [Set 2] Running warning check at 01:40 PM for 13:30 slot...');
      await this.sendWarnings('13:30');
    });

    // 04:10 PM - Warn for 16:00 slot
    const job4 = cron.schedule('10 16 * * *', async () => {
      console.log('⚠️ [Set 2] Running warning check at 04:10 PM for 16:00 slot...');
      await this.sendWarnings('16:00');
    });

    // 05:40 PM - Warn for 17:30 slot
    const job5 = cron.schedule('40 17 * * *', async () => {
      console.log('⚠️ [Set 2] Running warning check at 05:40 PM for 17:30 slot...');
      await this.sendWarnings('17:30');
    });

    this.jobs.push(job1, job2, job3, job4, job5);
    console.log('✅ Task Update Warning Checks (Set 2) scheduled');
  }

  /**
   * Set 3: Escalate (20 minutes after deadline)
   * Mark status as 'escalated' for users who still haven't updated
   */
  startEscalationChecks() {
    // 10:50 AM - Escalate for 10:30 slot
    const job1 = cron.schedule('50 10 * * *', async () => {
      console.log('🚨 [Set 3] Running escalation check at 10:50 AM for 10:30 slot...');
      await this.escalateMissed('10:30');
    });

    // 12:20 PM - Escalate for 12:00 slot
    const job2 = cron.schedule('20 12 * * *', async () => {
      console.log('🚨 [Set 3] Running escalation check at 12:20 PM for 12:00 slot...');
      await this.escalateMissed('12:00');
    });

    // 01:50 PM - Escalate for 13:30 slot
    const job3 = cron.schedule('50 13 * * *', async () => {
      console.log('🚨 [Set 3] Running escalation check at 01:50 PM for 13:30 slot...');
      await this.escalateMissed('13:30');
    });

    // 04:20 PM - Escalate for 16:00 slot
    const job4 = cron.schedule('20 16 * * *', async () => {
      console.log('🚨 [Set 3] Running escalation check at 04:20 PM for 16:00 slot...');
      await this.escalateMissed('16:00');
    });

    // 05:50 PM - Escalate for 17:30 slot
    const job5 = cron.schedule('50 17 * * *', async () => {
      console.log('🚨 [Set 3] Running escalation check at 05:50 PM for 17:30 slot...');
      await this.escalateMissed('17:30');
    });

    this.jobs.push(job1, job2, job3, job4, job5);
    console.log('✅ Task Update Escalation Checks (Set 3) scheduled');
  }

  /**
   * Check for pending updates (Set 1)
   * Just console log user IDs who haven't submitted
   */
  async checkPendingUpdates(scheduledTime) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all tasks for today with pending status for the specific time slot
      const tasks = await Task.find({
        date: today,
        'scheduledEntries.scheduledTime': scheduledTime,
        'scheduledEntries.status': 'pending'
      }).populate('userId', 'firstName lastName email employeeId');

      if (tasks.length === 0) {
        console.log(`✅ All users have submitted their ${scheduledTime} update`);
        return;
      }

      const pendingUserIds = [];
      const pendingUsers = [];

      for (const task of tasks) {
        const entry = task.scheduledEntries.find(
          e => e.scheduledTime === scheduledTime && e.status === 'pending'
        );

        if (entry) {
          pendingUserIds.push(task.userId._id);
          pendingUsers.push({
            userId: task.userId._id,
            name: `${task.userId.firstName} ${task.userId.lastName}`,
            email: task.userId.email,
            employeeId: task.userId.employeeId
          });
        }
      }

      console.log(`📋 [Set 1] ${pendingUserIds.length} users haven't submitted ${scheduledTime} update:`);
      console.log('User IDs:', pendingUserIds);
      console.log('Details:', pendingUsers);

    } catch (error) {
      console.error(`Error checking pending updates for ${scheduledTime}:`, error.message);
    }
  }

  /**
   * Send warnings (Set 2)
   * Update status to 'warning_sent' for pending updates
   */
  async sendWarnings(scheduledTime) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all tasks with pending status for the specific time slot
      const tasks = await Task.find({
        date: today,
        'scheduledEntries.scheduledTime': scheduledTime,
        'scheduledEntries.status': 'pending'
      }).populate('userId', 'firstName lastName email employeeId');

      if (tasks.length === 0) {
        console.log(`✅ No pending updates to warn for ${scheduledTime}`);
        return;
      }

      const warnedUserIds = [];
      const warnedUsers = [];

      for (const task of tasks) {
        const entry = task.scheduledEntries.find(
          e => e.scheduledTime === scheduledTime && e.status === 'pending'
        );

        if (entry) {
          // Update status to warning_sent
          entry.status = 'warning_sent';
          await task.save();

          warnedUserIds.push(task.userId._id);
          warnedUsers.push({
            userId: task.userId._id,
            name: `${task.userId.firstName} ${task.userId.lastName}`,
            email: task.userId.email,
            employeeId: task.userId.employeeId
          });
        }
      }

      console.log(`⚠️ [Set 2] ${warnedUserIds.length} users warned for missing ${scheduledTime} update:`);
      console.log('User IDs:', warnedUserIds);
      console.log('Details:', warnedUsers);
      console.log(`✅ Status updated to 'warning_sent' for ${scheduledTime} slot`);

    } catch (error) {
      console.error(`Error sending warnings for ${scheduledTime}:`, error.message);
    }
  }

  /**
   * Escalate missed updates (Set 3)
   * Update status to 'escalated' for updates still at 'warning_sent'
   */
  async escalateMissed(scheduledTime) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all tasks with warning_sent status for the specific time slot
      const tasks = await Task.find({
        date: today,
        'scheduledEntries.scheduledTime': scheduledTime,
        'scheduledEntries.status': 'warning_sent'
      }).populate('userId', 'firstName lastName email employeeId');

      if (tasks.length === 0) {
        console.log(`✅ No warnings to escalate for ${scheduledTime}`);
        return;
      }

      const escalatedUserIds = [];
      const escalatedUsers = [];

      for (const task of tasks) {
        const entry = task.scheduledEntries.find(
          e => e.scheduledTime === scheduledTime && e.status === 'warning_sent'
        );

        if (entry) {
          // Update status to escalated
          entry.status = 'escalated';
          await task.save();

          escalatedUserIds.push(task.userId._id);
          escalatedUsers.push({
            userId: task.userId._id,
            name: `${task.userId.firstName} ${task.userId.lastName}`,
            email: task.userId.email,
            employeeId: task.userId.employeeId
          });
        }
      }

      console.log(`🚨 [Set 3] ${escalatedUserIds.length} users escalated for missing ${scheduledTime} update:`);
      console.log('User IDs:', escalatedUserIds);
      console.log('Details:', escalatedUsers);
      console.log(`✅ Status updated to 'escalated' for ${scheduledTime} slot`);

    } catch (error) {
      console.error(`Error escalating missed updates for ${scheduledTime}:`, error.message);
    }
  }

  /**
   * Start all cron jobs
   */
  start() {
    console.log('\n🚀 Starting Task Update Monitoring Cron Jobs...\n');
    this.startReminderChecks();   // Set 1
    this.startWarningChecks();     // Set 2
    this.startEscalationChecks();  // Set 3
    console.log('\n✅ All Task Update Monitoring jobs started successfully\n');
  }

  /**
   * Stop all cron jobs
   */
  stop() {
    this.jobs.forEach(job => job.stop());
    console.log('⏹️ All Task Update Monitoring jobs stopped');
  }
}

module.exports = new TaskUpdateCron();

