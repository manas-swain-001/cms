const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../constant/enum');
const smsCronJob = require('../cron/smsCron');
const taskUpdateCron = require('../cron/taskUpdateCron');

const router = express.Router();

// @route   GET /api/cron/status
// @desc    Get cron job status
// @access  Private (Admin only)
router.get('/status', [
  auth,
  authorize(USER_ROLES.ADMIN)
], async (req, res) => {
  try {
    const status = smsCronJob.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('❌ Get cron status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while getting cron status',
      error: error.message
    });
  }
});

// @route   POST /api/cron/start
// @desc    Start cron jobs
// @access  Private (Admin only)
router.post('/start', [
  auth,
  authorize(USER_ROLES.ADMIN)
], async (req, res) => {
  try {
    smsCronJob.start();
    
    res.json({
      success: true,
      message: 'Cron jobs started successfully',
      data: smsCronJob.getStatus()
    });
  } catch (error) {
    console.error('❌ Start cron error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while starting cron jobs',
      error: error.message
    });
  }
});

// @route   POST /api/cron/stop
// @desc    Stop cron jobs
// @access  Private (Admin only)
router.post('/stop', [
  auth,
  authorize(USER_ROLES.ADMIN)
], async (req, res) => {
  try {
    smsCronJob.stop();
    
    res.json({
      success: true,
      message: 'Cron jobs stopped successfully',
      data: smsCronJob.getStatus()
    });
  } catch (error) {
    console.error('❌ Stop cron error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while stopping cron jobs',
      error: error.message
    });
  }
});

// @route   POST /api/cron/task-update/check-pending
// @desc    Manually trigger check for pending task updates (Set 1)
// @access  Private (Admin only)
router.post('/task-update/check-pending', [
  auth,
  authorize(USER_ROLES.ADMIN)
], async (req, res) => {
  try {
    const { scheduledTime } = req.body;
    
    if (!scheduledTime) {
      return res.status(400).json({
        success: false,
        message: 'scheduledTime is required (e.g., "10:30", "12:00", "13:30", "16:00", "17:30")'
      });
    }

    console.log(`Manual trigger: Checking pending updates for ${scheduledTime}`);
    await taskUpdateCron.checkPendingUpdates(scheduledTime);
    
    res.json({
      success: true,
      message: `Checked pending updates for ${scheduledTime}. See console for details.`
    });
  } catch (error) {
    console.error('Error in manual check:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   POST /api/cron/task-update/send-warnings
// @desc    Manually trigger warnings for missing updates (Set 2)
// @access  Private (Admin only)
router.post('/task-update/send-warnings', [
  auth,
  authorize(USER_ROLES.ADMIN)
], async (req, res) => {
  try {
    const { scheduledTime } = req.body;
    
    if (!scheduledTime) {
      return res.status(400).json({
        success: false,
        message: 'scheduledTime is required (e.g., "10:30", "12:00", "13:30", "16:00", "17:30")'
      });
    }

    console.log(`Manual trigger: Sending warnings for ${scheduledTime}`);
    await taskUpdateCron.sendWarnings(scheduledTime);
    
    res.json({
      success: true,
      message: `Warnings sent for ${scheduledTime}. See console for details.`
    });
  } catch (error) {
    console.error('Error in manual warning:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   POST /api/cron/task-update/escalate
// @desc    Manually trigger escalation for missing updates (Set 3)
// @access  Private (Admin only)
router.post('/task-update/escalate', [
  auth,
  authorize(USER_ROLES.ADMIN)
], async (req, res) => {
  try {
    const { scheduledTime } = req.body;
    
    if (!scheduledTime) {
      return res.status(400).json({
        success: false,
        message: 'scheduledTime is required (e.g., "10:30", "12:00", "13:30", "16:00", "17:30")'
      });
    }

    console.log(`Manual trigger: Escalating for ${scheduledTime}`);
    await taskUpdateCron.escalateMissed(scheduledTime);
    
    res.json({
      success: true,
      message: `Escalation processed for ${scheduledTime}. See console for details.`
    });
  } catch (error) {
    console.error('Error in manual escalation:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;
