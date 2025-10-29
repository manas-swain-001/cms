const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const { USER_ROLES } = require('../constant/enum');
const smsCronJob = require('../cron/smsCron');

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

module.exports = router;
