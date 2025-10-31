const cron = require('node-cron');
const { getCurrentISTTime } = require('../utils/dateUtils');

class TaskNotificationCron {
  constructor(socketHandler) {
    this.socketHandler = socketHandler;
    this.jobs = [];
  }

  /**
   * Start all task update notification cron jobs
   * Sends notifications to all connected users at task update times
   */
  start() {
    // 10:30 AM IST - First task update reminder
    const job1 = cron.schedule('30 10 * * *', async () => {
      console.log('⏰ [Task Notification] Sending notification at 10:30 AM IST...');
      await this.sendTaskUpdateNotification('10:30');
    }, {
      timezone: 'Asia/Kolkata' // IST timezone
    });

    // 12:00 PM IST - Second task update reminder
    const job2 = cron.schedule('0 12 * * *', async () => {
      console.log('⏰ [Task Notification] Sending notification at 12:00 PM IST...');
      await this.sendTaskUpdateNotification('12:00');
    }, {
      timezone: 'Asia/Kolkata'
    });

    // 01:30 PM IST (13:30) - Third task update reminder
    const job3 = cron.schedule('30 13 * * *', async () => {
      console.log('⏰ [Task Notification] Sending notification at 01:30 PM IST...');
      await this.sendTaskUpdateNotification('13:30');
    }, {
      timezone: 'Asia/Kolkata'
    });

    // 04:00 PM IST (16:00) - Fourth task update reminder
    const job4 = cron.schedule('0 16 * * *', async () => {
      console.log('⏰ [Task Notification] Sending notification at 04:00 PM IST...');
      await this.sendTaskUpdateNotification('16:00');
    }, {
      timezone: 'Asia/Kolkata'
    });

    // 05:30 PM IST (17:30) - Fifth task update reminder
    const job5 = cron.schedule('30 17 * * *', async () => {
      console.log('⏰ [Task Notification] Sending notification at 05:30 PM IST...');
      await this.sendTaskUpdateNotification('17:30');
    }, {
      timezone: 'Asia/Kolkata'
    });

    this.jobs.push(job1, job2, job3, job4, job5);
    console.log('✅ Task Update Notification Cron Jobs scheduled');
    console.log('   - 10:30 AM IST');
    console.log('   - 12:00 PM IST');
    console.log('   - 01:30 PM IST');
    console.log('   - 04:00 PM IST');
    console.log('   - 05:30 PM IST');
  }

  /**
   * Send task update notification to all connected users
   * @param {string} scheduledTime - The task update time (e.g., '10:30', '12:00')
   */
  async sendTaskUpdateNotification(scheduledTime) {
    try {
      if (!this.socketHandler) {
        console.error('Socket handler not initialized');
        return;
      }

      // Format the time for display in user-friendly format (for message)
      const displayTime = this.formatTimeForMessage(scheduledTime);
      // Format with AM/PM for data object reference
      const formattedTime = this.formatTimeForDisplay(scheduledTime);
      
      // Format message with time and reminder text
      const message = `${displayTime} — Kindly update your tasks.`;

      // Create notification payload according to spec
      const notification = {
        id: getCurrentISTTime().toISOString(),
        title: 'Tasks Update',
        message: message, // e.g., "10:30 — Kindly update your tasks." or "01:30 — Kindly update your tasks."
        type: 'task',
        timestamp: getCurrentISTTime().toISOString(),
        read: false,
        data: {
          scheduledTime: scheduledTime,
          formattedTime: formattedTime, // Full format with AM/PM for reference
          reminderType: 'task_update'
        }
      };

      // Broadcast to all connected users
      this.socketHandler.broadcastToAll('notification', notification);

      const connectedUsers = this.socketHandler.getConnectedUsers().length;
      console.log(`✅ Task update notification sent to ${connectedUsers} connected user(s) at ${formattedTime}`);

    } catch (error) {
      console.error('❌ Error sending task update notification:', error);
    }
  }

  /**
   * Format time for message (e.g., '10:30' -> '10:30', '13:30' -> '01:30')
   * Simple 12-hour format without AM/PM for cleaner message display
   * @param {string} time - Time in HH:MM format (24-hour)
   * @returns {string} Formatted time string (12-hour format)
   */
  formatTimeForMessage(time) {
    const [hours, minutes] = time.split(':').map(Number);
    
    if (hours === 0) {
      return `12:${minutes.toString().padStart(2, '0')}`;
    } else if (hours <= 12) {
      return `${hours}:${minutes.toString().padStart(2, '0')}`;
    } else {
      const displayHour = hours - 12;
      return `${displayHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Format time for display (e.g., '10:30' -> '10:30 AM', '13:30' -> '01:30 PM')
   * @param {string} time - Time in HH:MM format (24-hour)
   * @returns {string} Formatted time string with AM/PM
   */
  formatTimeForDisplay(time) {
    const [hours, minutes] = time.split(':').map(Number);
    
    if (hours === 0) {
      return `12:${minutes.toString().padStart(2, '0')} AM`;
    } else if (hours < 12) {
      return `${hours}:${minutes.toString().padStart(2, '0')} AM`;
    } else if (hours === 12) {
      return `12:${minutes.toString().padStart(2, '0')} PM`;
    } else {
      const displayHour = hours - 12;
      return `${displayHour}:${minutes.toString().padStart(2, '0')} PM`;
    }
  }

  /**
   * Stop all cron jobs
   */
  stop() {
    this.jobs.forEach(job => {
      if (job) {
        job.stop();
      }
    });
    this.jobs = [];
    console.log('🛑 Task Update Notification Cron Jobs stopped');
  }

  /**
   * Get status of cron jobs
   */
  getStatus() {
    return {
      active: this.jobs.length > 0,
      scheduledTimes: ['10:30', '12:00', '13:30', '16:00', '17:30'],
      timezone: 'Asia/Kolkata (IST)'
    };
  }
}

module.exports = TaskNotificationCron;

